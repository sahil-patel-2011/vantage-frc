import { describe, expect, it } from "vitest";
import { computeMetrics, daysToDue, sortTodos, statusLabel, withFlags } from "./evaluate";
import type { TeamTodo } from "./types";

function base(overrides: Partial<Omit<TeamTodo, "flags">> = {}): Omit<TeamTodo, "flags"> {
  return {
    id: "t1",
    title: "Wire intake",
    notes: "",
    links: [],
    status: "todo",
    assigneeUserId: null,
    assigneeName: null,
    subteamId: null,
    subteamName: null,
    subteamColor: null,
    dueOn: null,
    completedAt: null,
    completedBy: null,
    createdBy: "u1",
    createdByName: "Alex",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("todo evaluate helpers", () => {
  it("labels statuses", () => {
    expect(statusLabel("todo")).toBe("To do");
    expect(statusLabel("doing")).toBe("Doing");
    expect(statusLabel("done")).toBe("Done");
  });

  it("computes due-day deltas and flags", () => {
    expect(daysToDue("2026-02-10", "2026-02-15")).toBe(-5);
    expect(daysToDue("2026-02-17", "2026-02-15")).toBe(2);
    const overdue = withFlags(base({ dueOn: "2026-02-01" }), "2026-02-15");
    expect(overdue.flags.overdue).toBe(true);
    const doneLate = withFlags(base({ status: "done", dueOn: "2026-02-01" }), "2026-02-15");
    expect(doneLate.flags.overdue).toBe(false);
  });

  it("sorts doing first, then overdue, then due date", () => {
    const sorted = sortTodos([
      withFlags(base({ id: "d", status: "done", dueOn: "2026-02-01" }), "2026-02-15"),
      withFlags(base({ id: "t", status: "todo", dueOn: "2026-03-01" }), "2026-02-15"),
      withFlags(base({ id: "o", status: "todo", dueOn: "2026-02-01" }), "2026-02-15"),
      withFlags(base({ id: "g", status: "doing", dueOn: "2026-03-01" }), "2026-02-15"),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["g", "o", "t", "d"]);
  });

  it("counts mine-open without inventing rows", () => {
    const metrics = computeMetrics(
      [
        withFlags(base({ id: "1", status: "todo", assigneeUserId: "me" }), "2026-02-15"),
        withFlags(base({ id: "2", status: "doing", assigneeUserId: "other" }), "2026-02-15"),
        withFlags(base({ id: "3", status: "done", assigneeUserId: "me" }), "2026-02-15"),
      ],
      "me",
    );
    expect(metrics).toMatchObject({ total: 3, todo: 1, doing: 1, done: 1, mineOpen: 1 });
  });
});
