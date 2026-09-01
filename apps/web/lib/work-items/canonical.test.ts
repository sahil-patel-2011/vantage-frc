import { describe, expect, it } from "vitest";
import {
  canonicalOwnerName,
  fromBuildTask,
  fromMilestone,
  fromTaskStatus,
  fromTodo,
  fromTodoStatus,
  ownedBy,
  resolveOwnerName,
  resolveOwnerNames,
  sortWorkItems,
  summarizeWorkItems,
  toMilestoneStatus,
  toTaskStatus,
  toTodoStatus,
  workItemCalendarEntries,
  workItemFlags,
  workloadByMember,
} from "./canonical";
import type { WorkItem } from "./types";

const ORG = "11111111-1111-4111-8111-111111111111";
const ASOF = "2026-03-10";

const roster = [
  { userId: "u-sam", name: "Sam Rodriguez" },
  { userId: "u-alex", name: "Alex Rodriguez" },
  { userId: "u-jo", name: "Jo Chen" },
];

const todo = (over: Partial<Parameters<typeof fromTodo>[0]> = {}) =>
  fromTodo(
    {
      id: "t1",
      title: "Wire the elevator",
      status: "todo",
      dueOn: null,
      assigneeUserId: null,
      assigneeName: null,
      subteamId: null,
      subteamName: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      completedAt: null,
      ...over,
    },
    ORG,
    ASOF,
  );

const task = (over: Partial<Parameters<typeof fromBuildTask>[0]> = {}) =>
  fromBuildTask(
    {
      id: "b1",
      title: "Machine the gearbox plate",
      status: "todo",
      dueOn: null,
      assignees: [],
      subsystem: "drivetrain",
      createdAt: "2026-03-01T00:00:00.000Z",
      doneAt: null,
      ...over,
    },
    ORG,
    ASOF,
    roster,
  );

describe("status translation", () => {
  it("maps each tracker's words onto the shared set", () => {
    expect(fromTodoStatus("todo")).toBe("planned");
    expect(fromTodoStatus("doing")).toBe("in_progress");
    expect(fromTodoStatus("done")).toBe("done");

    expect(fromTaskStatus("todo")).toBe("planned");
    expect(fromTaskStatus("in_progress")).toBe("in_progress");
    expect(fromTaskStatus("blocked")).toBe("blocked");
    expect(fromTaskStatus("archived")).toBe("dropped");
  });

  it("falls back to planned for a status word none of the trackers know", () => {
    expect(fromTodoStatus("nonsense")).toBe("planned");
    expect(fromTaskStatus("nonsense")).toBe("planned");
  });

  it("round-trips the statuses a todo can actually store", () => {
    expect(toTodoStatus("planned")).toBe("todo");
    expect(toTodoStatus("in_progress")).toBe("doing");
    expect(toTodoStatus("done")).toBe("done");
  });

  it("refuses to invent a todo status for blocked or dropped instead of writing 'doing'", () => {
    // team_todos has no blocked/archived column; null forces the caller to decide.
    expect(toTodoStatus("blocked")).toBeNull();
    expect(toTodoStatus("dropped")).toBeNull();
  });

  it("keeps the build board total, mapping dropped onto archived", () => {
    expect(toTaskStatus("planned")).toBe("todo");
    expect(toTaskStatus("blocked")).toBe("blocked");
    expect(toTaskStatus("dropped")).toBe("archived");
  });

  it("collapses blocked into in_progress for the season plan, which has no blocked state", () => {
    expect(toMilestoneStatus("blocked")).toBe("in_progress");
    expect(toMilestoneStatus("dropped")).toBe("dropped");
  });
});

describe("workItemFlags", () => {
  it("uses one overdue/due-soon rule for every tracker", () => {
    expect(workItemFlags({ dueOn: "2026-03-07", status: "planned" }, ASOF)).toMatchObject({
      daysToDue: -3,
      overdue: true,
      dueSoon: false,
      open: true,
    });
    expect(workItemFlags({ dueOn: "2026-03-13", status: "in_progress" }, ASOF)).toMatchObject({
      daysToDue: 3,
      overdue: false,
      dueSoon: true,
    });
    expect(workItemFlags({ dueOn: "2026-03-14", status: "planned" }, ASOF).dueSoon).toBe(false);
  });

  it("never flags closed work as overdue", () => {
    expect(workItemFlags({ dueOn: "2026-01-01", status: "done" }, ASOF).overdue).toBe(false);
    expect(workItemFlags({ dueOn: "2026-01-01", status: "dropped" }, ASOF).overdue).toBe(false);
  });

  it("treats blocked work as open, so a blocked task can still be overdue", () => {
    const flags = workItemFlags({ dueOn: "2026-01-01", status: "blocked" }, ASOF);
    expect(flags.open).toBe(true);
    expect(flags.overdue).toBe(true);
  });

  it("returns null days for an undated or unparseable due date", () => {
    expect(workItemFlags({ dueOn: null, status: "planned" }, ASOF).daysToDue).toBeNull();
    expect(workItemFlags({ dueOn: "not-a-date", status: "planned" }, ASOF).daysToDue).toBeNull();
  });
});

describe("owner resolution", () => {
  it("links an exact single name match to a member id", () => {
    expect(resolveOwnerName("Sam Rodriguez", roster)).toEqual({
      userId: "u-sam",
      name: "Sam Rodriguez",
      link: "matched",
    });
  });

  it("matches regardless of token order and casing", () => {
    expect(resolveOwnerName("rodriguez, sam", roster).userId).toBe("u-sam");
  });

  it("leaves a nickname or initial unlinked rather than guessing a person", () => {
    const owner = resolveOwnerName("Sam R.", roster);
    expect(owner.userId).toBeNull();
    expect(owner.link).toBe("unlinked");
    expect(owner.name).toBe("Sam R.");
  });

  it("leaves a bare shared surname unlinked instead of picking one of the two Rodriguezes", () => {
    const owner = resolveOwnerName("Rodriguez", roster);
    expect(owner.userId).toBeNull();
    expect(owner.link).toBe("unlinked");
  });

  it("marks a name two members genuinely share as ambiguous, never auto-linked", () => {
    const twins = [
      { userId: "u-one", name: "Jamie Park" },
      { userId: "u-two", name: "Jamie Park" },
    ];
    const owner = resolveOwnerName("Jamie Park", twins);
    expect(owner.userId).toBeNull();
    expect(owner.link).toBe("ambiguous");
  });

  it("leaves a genuine non-member (parent volunteer, alum) unlinked with their name intact", () => {
    expect(resolveOwnerName("Coach Whitaker", roster)).toEqual({
      userId: null,
      name: "Coach Whitaker",
      link: "unlinked",
    });
  });

  it("drops empty names and de-duplicates by resolved identity", () => {
    const owners = resolveOwnerNames(["Sam Rodriguez", "  ", "rodriguez, sam", "Jo Chen"], roster);
    expect(owners.map((owner) => owner.userId)).toEqual(["u-sam", "u-jo"]);
  });

  it("de-duplicates unlinked names case-insensitively", () => {
    const owners = resolveOwnerNames(["Coach Whitaker", "coach whitaker"], roster);
    expect(owners).toHaveLength(1);
  });

  it("canonicalizes a stored owner name to the roster spelling to stop free-text drift", () => {
    expect(canonicalOwnerName("  rodriguez,  sam ", roster)).toBe("Sam Rodriguez");
  });

  it("keeps an unmatched name exactly as typed rather than rewriting it", () => {
    expect(canonicalOwnerName("Sam R.", roster)).toBe("Sam R.");
  });
});

describe("mapping into the canonical shape", () => {
  it("carries a todo's member assignee straight through as a linked owner", () => {
    const item = todo({ assigneeUserId: "u-jo", assigneeName: "Jo Chen", status: "doing" });
    expect(item.status).toBe("in_progress");
    expect(item.owners).toEqual([{ userId: "u-jo", name: "Jo Chen", link: "member" }]);
    expect(item.href).toContain("/todos?");
    expect(item.href).toContain("todoId=t1");
  });

  it("resolves a build task's free-text assignees against the roster", () => {
    const item = task({ assignees: ["Sam Rodriguez", "Sam R."] });
    expect(item.owners).toEqual([
      { userId: "u-sam", name: "Sam Rodriguez", link: "matched" },
      { userId: null, name: "Sam R.", link: "unlinked" },
    ]);
  });

  it("maps a milestone's owner id and category", () => {
    const item = fromMilestone(
      {
        id: "m1",
        title: "Ship the drivetrain",
        status: "in_progress",
        dueOn: "2026-03-12",
        ownerUserId: "u-sam",
        ownerName: "Sam Rodriguez",
        category: "build",
        createdAt: null,
      },
      ORG,
      ASOF,
    );
    expect(item.source).toBe("milestone");
    expect(item.grouping).toBe("build");
    expect(item.owners[0]!.link).toBe("member");
    expect(item.flags.dueSoon).toBe(true);
  });
});

describe("sortWorkItems", () => {
  it("puts overdue work first, then blocked, then active, then soonest due", () => {
    const items = [
      todo({ id: "later", dueOn: "2026-03-20" }),
      task({ id: "overdue", dueOn: "2026-03-01" }),
      task({ id: "blocked", status: "blocked" }),
      todo({ id: "doing", status: "doing" }),
    ];
    expect(sortWorkItems(items).map((item) => item.id)).toEqual(["overdue", "blocked", "doing", "later"]);
  });

  it("sorts undated items after dated ones and does not mutate the input", () => {
    const items = [todo({ id: "undated" }), todo({ id: "dated", dueOn: "2026-04-01" })];
    expect(sortWorkItems(items).map((item) => item.id)).toEqual(["dated", "undated"]);
    expect(items.map((item) => item.id)).toEqual(["undated", "dated"]);
  });
});

describe("summarizeWorkItems", () => {
  it("counts across all three sources with one set of rules", () => {
    const items: WorkItem[] = [
      todo({ id: "a", status: "done", completedAt: "2026-03-05T00:00:00.000Z" }),
      todo({ id: "b", dueOn: "2026-03-01", assigneeUserId: "u-jo", assigneeName: "Jo Chen" }),
      task({ id: "c", status: "blocked", assignees: ["Sam R."] }),
      task({ id: "d", dueOn: "2026-03-11" }),
    ];
    const summary = summarizeWorkItems(items);
    expect(summary).toMatchObject({
      total: 4,
      open: 3,
      blocked: 1,
      done: 1,
      overdue: 1,
      dueSoon: 1,
      unowned: 1,
      unlinkedOwners: 1,
      bySource: { todo: 2, build_task: 2, milestone: 0 },
    });
  });

  it("does not count a closed item's unlinked owner as a problem to fix", () => {
    const summary = summarizeWorkItems([task({ status: "done", assignees: ["Sam R."] })]);
    expect(summary.unlinkedOwners).toBe(0);
  });
});

describe("workItemCalendarEntries", () => {
  it("projects only open, due-dated work, oldest date first", () => {
    const entries = workItemCalendarEntries([
      task({ id: "b", dueOn: "2026-03-15" }),
      todo({ id: "a", dueOn: "2026-03-01" }),
      todo({ id: "undated" }),
      todo({ id: "closed", status: "done", dueOn: "2026-03-02" }),
    ]);
    expect(entries.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(entries[0]).toMatchObject({ date: "2026-03-01", overdue: true, source: "todo" });
  });
});

describe("workloadByMember", () => {
  it("counts only resolved owner ids, so an unlinked lookalike is not charged to a member", () => {
    const items = [
      task({ id: "linked", assignees: ["Sam Rodriguez"] }),
      task({ id: "lookalike", assignees: ["Sam R."] }),
      task({ id: "blocked", status: "blocked", assignees: ["Sam Rodriguez"] }),
    ];
    const workload = workloadByMember([{ userId: "u-sam", name: "Sam Rodriguez" }], items);
    expect(workload[0]).toMatchObject({ open: 2, blocked: 1, overdue: 0 });
  });

  it("reports zero for a member with nothing assigned", () => {
    expect(workloadByMember([{ userId: "u-jo", name: "Jo Chen" }], [task()])[0]).toMatchObject({ open: 0 });
  });
});

describe("ownedBy", () => {
  it("finds work across sources for one member", () => {
    const items = [
      todo({ id: "t", assigneeUserId: "u-sam", assigneeName: "Sam Rodriguez" }),
      task({ id: "b", assignees: ["Sam Rodriguez"] }),
      task({ id: "other", assignees: ["Jo Chen"] }),
    ];
    expect(ownedBy(items, "u-sam").map((item) => item.id)).toEqual(["t", "b"]);
  });
});
