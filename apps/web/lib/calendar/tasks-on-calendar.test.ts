import { describe, expect, it } from "vitest";
import {
  filterTasksBySubteam,
  isOverdue,
  taskSummary,
  tasksByDay,
  type TaskOnCalendar,
} from "./tasks-on-calendar";

function task(over: Partial<TaskOnCalendar> & { id: string }): TaskOnCalendar {
  return {
    title: "Task",
    status: "todo",
    dueOn: "2026-09-15",
    assigneeUserId: null,
    assigneeName: null,
    subteamId: null,
    subteamName: null,
    subteamColor: null,
    ...over,
  };
}

describe("filterTasksBySubteam", () => {
  it("shows everything with no filter", () => {
    const tasks = [task({ id: "a", subteamId: "mech" }), task({ id: "b" })];
    expect(filterTasksBySubteam(tasks, null).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("keeps whole-team tasks visible under a subteam filter, like events do", () => {
    const tasks = [
      task({ id: "mech", subteamId: "mech" }),
      task({ id: "prog", subteamId: "prog" }),
      task({ id: "team", subteamId: null }),
    ];
    expect(filterTasksBySubteam(tasks, "mech").map((t) => t.id)).toEqual(["mech", "team"]);
  });
});

describe("tasksByDay", () => {
  it("buckets by the due date exactly as stored", () => {
    const byDay = tasksByDay([
      task({ id: "a", dueOn: "2026-09-15" }),
      task({ id: "b", dueOn: "2026-09-15" }),
      task({ id: "c", dueOn: "2026-09-16" }),
    ]);
    expect(byDay.get("2026-09-15")?.map((t) => t.id)).toEqual(["a", "b"]);
    expect(byDay.get("2026-09-16")?.map((t) => t.id)).toEqual(["c"]);
  });

  it("drops done tasks — the calendar is about what is still ahead", () => {
    const byDay = tasksByDay([
      task({ id: "open" }),
      task({ id: "finished", status: "done" }),
    ]);
    expect(byDay.get("2026-09-15")?.map((t) => t.id)).toEqual(["open"]);
  });

  it("puts started work first, then sorts by title, so the order does not jump", () => {
    const byDay = tasksByDay([
      task({ id: "z", title: "Zip ties" }),
      task({ id: "a", title: "Anodise" }),
      task({ id: "d", title: "Wire the elevator", status: "doing" }),
    ]);
    expect(byDay.get("2026-09-15")?.map((t) => t.title)).toEqual([
      "Wire the elevator",
      "Anodise",
      "Zip ties",
    ]);
  });

  it("ignores a malformed due date instead of creating a junk day cell", () => {
    const byDay = tasksByDay([task({ id: "bad", dueOn: "not-a-date" })]);
    expect(byDay.size).toBe(0);
  });

  it("returns an empty map for no tasks — not a placeholder day", () => {
    expect(tasksByDay([]).size).toBe(0);
  });
});

describe("isOverdue", () => {
  it("is true only strictly before today", () => {
    expect(isOverdue(task({ id: "a", dueOn: "2026-09-14" }), "2026-09-15")).toBe(true);
    expect(isOverdue(task({ id: "b", dueOn: "2026-09-15" }), "2026-09-15")).toBe(false);
    expect(isOverdue(task({ id: "c", dueOn: "2026-09-16" }), "2026-09-15")).toBe(false);
  });

  it("never calls a finished task overdue", () => {
    expect(isOverdue(task({ id: "a", dueOn: "2020-01-01", status: "done" }), "2026-09-15")).toBe(
      false,
    );
  });

  it("compares across a year and month boundary correctly", () => {
    expect(isOverdue(task({ id: "a", dueOn: "2025-12-31" }), "2026-01-01")).toBe(true);
    expect(isOverdue(task({ id: "b", dueOn: "2026-01-02" }), "2026-01-01")).toBe(false);
  });
});

describe("taskSummary", () => {
  it("counts what is really there and nothing else", () => {
    const summary = taskSummary(
      [
        task({ id: "late1", dueOn: "2026-09-10" }),
        task({ id: "late2", dueOn: "2026-09-14", status: "doing" }),
        task({ id: "today", dueOn: "2026-09-15" }),
        task({ id: "later", dueOn: "2026-09-30" }),
        task({ id: "done", dueOn: "2026-09-01", status: "done" }),
      ],
      "2026-09-15",
    );
    expect(summary).toEqual({ open: 4, overdue: 2, dueToday: 1 });
  });

  it("is all zeros for an empty list, so the strip can hide instead of showing 0s", () => {
    expect(taskSummary([], "2026-09-15")).toEqual({ open: 0, overdue: 0, dueToday: 0 });
  });

  it("does not double-count a task that is both overdue and not today", () => {
    const summary = taskSummary([task({ id: "a", dueOn: "2026-09-01" })], "2026-09-15");
    expect(summary.overdue + summary.dueToday).toBeLessThanOrEqual(summary.open);
  });
});
