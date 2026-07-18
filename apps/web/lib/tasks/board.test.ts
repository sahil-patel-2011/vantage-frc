import { describe, expect, it } from "vitest";
import { buildBoard, buildMemberWorkload, focusList, isoWeekStart, priorityWeight, statusLabel, summarizeMeetingOutput, visibleBenchmarkMedian } from "./board";
import type { BuildTask, TaskPriority, TaskStatus } from "./types";

let seq = 0;
function task(overrides: Partial<BuildTask> = {}): BuildTask {
  seq += 1;
  return {
    id: `t-${seq}`,
    title: `Task ${seq}`,
    subsystem: "general",
    status: "todo",
    priority: "normal",
    assignee: null,
    estimateHours: null,
    dueOn: null,
    blockedReason: null,
    notes: null,
    doneAt: null,
    seasonYear: 2026,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const ASOF = "2026-02-15";

describe("buildBoard columns", () => {
  it("groups tasks into the canonical column order and hides archived", () => {
    const board = buildBoard(
      [
        task({ status: "todo" }),
        task({ status: "in_progress" }),
        task({ status: "blocked" }),
        task({ status: "done", doneAt: "2026-02-10T00:00:00Z" }),
        task({ status: "archived" }),
      ],
      ASOF,
    );
    expect(board.columns.map((c) => c.status)).toEqual(["todo", "in_progress", "blocked", "done"]);
    expect(board.columns.every((c) => c.count === 1)).toBe(true);
    // archived is excluded from the board and from live metrics
    expect(board.metrics.total).toBe(4);
  });

  it("orders tasks within a column by priority then due date", () => {
    const board = buildBoard(
      [
        task({ status: "todo", priority: "low", title: "low" }),
        task({ status: "todo", priority: "critical", title: "crit" }),
        task({ status: "todo", priority: "high", dueOn: "2026-02-20", title: "high-soon" }),
      ],
      ASOF,
    );
    const todo = board.columns.find((c) => c.status === "todo");
    expect(todo?.tasks.map((t) => t.title)).toEqual(["crit", "high-soon", "low"]);
  });
});

describe("flags", () => {
  it("marks overdue and due-soon for active tasks only", () => {
    const board = buildBoard(
      [
        task({ id: "over", status: "todo", dueOn: "2026-02-01" }),
        task({ id: "soon", status: "in_progress", dueOn: "2026-02-17" }),
        task({ id: "future", status: "todo", dueOn: "2026-06-01" }),
        task({ id: "done-late", status: "done", dueOn: "2026-02-01", doneAt: "2026-02-14T00:00:00Z" }),
      ],
      ASOF,
    );
    const flat = board.columns.flatMap((c) => c.tasks);
    expect(flat.find((t) => t.id === "over")?.flags.overdue).toBe(true);
    expect(flat.find((t) => t.id === "soon")?.flags.dueSoon).toBe(true);
    expect(flat.find((t) => t.id === "future")?.flags.overdue).toBe(false);
    // A completed task is never overdue even if its due date passed.
    expect(flat.find((t) => t.id === "done-late")?.flags.overdue).toBe(false);
    expect(board.metrics.overdue).toBe(1);
    expect(board.metrics.dueSoon).toBe(1);
  });
});

describe("metrics", () => {
  it("counts statuses, unassigned open work, and open hours", () => {
    const board = buildBoard(
      [
        task({ status: "todo", assignee: null, estimateHours: 4 }),
        task({ status: "in_progress", assignee: "Riya", estimateHours: 2.5 }),
        task({ status: "blocked", assignee: null, estimateHours: 1 }),
        task({ status: "done", assignee: "Sam", estimateHours: 8, doneAt: "2026-02-09T00:00:00Z" }),
      ],
      ASOF,
    );
    const m = board.metrics;
    expect(m.total).toBe(4);
    expect(m.open).toBe(3);
    expect(m.done).toBe(1);
    expect(m.blocked).toBe(1);
    expect(m.inProgress).toBe(1);
    expect(m.unassigned).toBe(2); // todo + blocked have no assignee
    expect(m.completionPct).toBe(0.25);
    expect(m.estimatedOpenHours).toBe(7.5); // 4 + 2.5 + 1
  });

  it("breaks down progress by subsystem, sorted by open work", () => {
    const board = buildBoard(
      [
        task({ subsystem: "drivetrain", status: "todo" }),
        task({ subsystem: "drivetrain", status: "todo" }),
        task({ subsystem: "software", status: "done", doneAt: "2026-02-10T00:00:00Z" }),
      ],
      ASOF,
    );
    expect(board.metrics.bySubsystem[0]?.subsystem).toBe("drivetrain");
    expect(board.metrics.bySubsystem[0]?.open).toBe(2);
    const software = board.metrics.bySubsystem.find((s) => s.subsystem === "software");
    expect(software?.completionPct).toBe(1);
  });

  it("reports open counts by priority, highest first, omitting empties", () => {
    const board = buildBoard(
      [
        task({ status: "todo", priority: "critical" }),
        task({ status: "todo", priority: "low" }),
        task({ status: "done", priority: "high", doneAt: "2026-02-10T00:00:00Z" }),
      ],
      ASOF,
    );
    expect(board.metrics.byPriority.map((p) => p.priority)).toEqual(["critical", "low"]);
    expect(board.metrics.byPriority.every((p) => p.open > 0)).toBe(true);
  });
});

describe("throughput", () => {
  it("buckets completed tasks into the trailing ISO weeks", () => {
    const board = buildBoard(
      [
        task({ status: "done", doneAt: "2026-02-10T12:00:00Z" }), // week of Mon 2026-02-09
        task({ status: "done", doneAt: "2026-02-11T09:00:00Z" }), // same week
        task({ status: "done", doneAt: "2026-02-03T09:00:00Z" }), // week of Mon 2026-02-02
        task({ status: "todo" }), // not counted
      ],
      ASOF,
      { throughputWeeks: 3 },
    );
    expect(board.metrics.throughput).toHaveLength(3);
    const last = board.metrics.throughput.at(-1);
    expect(last?.weekStart).toBe("2026-02-09");
    expect(last?.completed).toBe(2);
    const prior = board.metrics.throughput.find((w) => w.weekStart === "2026-02-02");
    expect(prior?.completed).toBe(1);
  });

  it("computes ISO week start as the Monday", () => {
    expect(isoWeekStart("2026-02-15")).toBe("2026-02-09"); // Sunday -> prior Monday
    expect(isoWeekStart("2026-02-09")).toBe("2026-02-09"); // Monday -> itself
  });
});

describe("focusList", () => {
  it("ranks open unblocked tasks by priority, then due proximity, then age", () => {
    const focus = focusList(
      [
        task({ id: "old-normal", priority: "normal", createdAt: "2026-01-01T00:00:00Z" }),
        task({ id: "crit", priority: "critical" }),
        task({ id: "high-due", priority: "high", dueOn: "2026-02-18" }),
        task({ id: "high-nodue", priority: "high" }),
        task({ id: "blocked", priority: "critical", status: "blocked" }),
        task({ id: "done", priority: "critical", status: "done", doneAt: "2026-02-10T00:00:00Z" }),
      ],
      ASOF,
    );
    expect(focus.map((t) => t.id)).toEqual(["crit", "high-due", "high-nodue", "old-normal"]);
    // blocked and done never appear in the focus list
    expect(focus.some((t) => t.id === "blocked" || t.id === "done")).toBe(false);
  });

  it("respects the limit", () => {
    const tasks = Array.from({ length: 10 }, () => task({ status: "todo" }));
    expect(focusList(tasks, ASOF, 3)).toHaveLength(3);
  });
});

describe("labels + weights", () => {
  it("labels statuses and orders priority weights", () => {
    expect(statusLabel("in_progress")).toBe("In progress");
    const order: TaskPriority[] = ["low", "normal", "high", "critical"];
    const weights = order.map(priorityWeight);
    expect(weights).toEqual([1, 2, 3, 4]);
  });

  it("treats an empty board as fully zeroed", () => {
    const board = buildBoard([], ASOF);
    expect(board.metrics.total).toBe(0);
    expect(board.metrics.completionPct).toBe(0);
    expect(board.focus).toEqual([]);
    const statuses: TaskStatus[] = board.columns.map((c) => c.status);
    expect(statuses).toEqual(["todo", "in_progress", "blocked", "done"]);
  });
});

describe("team workload intelligence", () => {
  it("supports collaborative ownership and identifies available members", () => {
    const tasks = [
      task({ status: "in_progress", assignee: "Avery", assignees: ["Avery", "Jordan"], estimateHours: 3 }),
      task({ status: "todo", assignee: "Jordan", assignees: ["Jordan"], estimateHours: 2 }),
    ];
    const workload = buildMemberWorkload([
      { userId: "u1", name: "Avery" },
      { userId: "u2", name: "Jordan" },
      { userId: "u3", name: "Sam" },
    ], tasks);
    expect(workload.find((row) => row.name === "Jordan")).toMatchObject({ openTasks: 2, estimatedOpenHours: 5, availableNow: false });
    expect(workload.find((row) => row.name === "Sam")?.availableNow).toBe(true);
  });

  it("correlates weekly hours with completed tasks without inventing a ratio", () => {
    expect(summarizeMeetingOutput({ weekStart: "2026-07-13", loggedHours: 47.04, tasksCompleted: 4 })).toEqual({
      weekStart: "2026-07-13", loggedHours: 47, tasksCompleted: 4, hoursPerCompletedTask: 11.8,
    });
    expect(summarizeMeetingOutput({ weekStart: "2026-07-13", loggedHours: 8, tasksCompleted: 0 }).hoursPerCompletedTask).toBeNull();
  });

  it("hides anonymous norms until opt-in and the five-team privacy floor", () => {
    expect(visibleBenchmarkMedian({ optedIn: false, teamCount: 20, median: 18 })).toBeNull();
    expect(visibleBenchmarkMedian({ optedIn: true, teamCount: 4, median: 18 })).toBeNull();
    expect(visibleBenchmarkMedian({ optedIn: true, teamCount: 5, median: 18.26 })).toBe(18.3);
  });
});
