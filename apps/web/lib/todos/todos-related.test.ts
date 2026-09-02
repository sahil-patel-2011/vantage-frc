import { describe, expect, it } from "vitest";
import { withFlags } from "./evaluate";
import type { TeamTodo } from "./types";
import {
  TODOS_RELATED_INCLUDE,
  filterTodos,
  todoDeepLink,
  todosNextActions,
} from "./todos-related";
import { teamHubRelatedLinks } from "../team/team-related";

function base(overrides: Partial<Omit<TeamTodo, "flags">> = {}): Omit<TeamTodo, "flags"> {
  return {
    id: "t1",
    title: "Wire intake",
    notes: "",
    status: "todo",
    taskStatus: "todo",
    priority: "normal",
    subsystem: "general",
    assignees: [],
    blockedReason: null,
    estimateHours: null,
    seasonYear: 2026,
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

describe("todos-related Soft-UI helpers", () => {
  it("exposes Calendar / Messages / Practice cross-links", () => {
    const links = teamHubRelatedLinks("org-1", {
      active: "todos",
      include: TODOS_RELATED_INCLUDE,
    });
    expect(links.map((l) => l.id)).toEqual(["calendar", "messages", "practice"]);
    expect(links.every((l) => l.href.includes("orgId=org-1"))).toBe(true);
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
  });

  it("filters real rows without inventing DEMO todos", () => {
    const rows = [
      withFlags(base({ id: "1", status: "todo", assigneeUserId: "me", dueOn: "2026-02-01" }), "2026-02-15"),
      withFlags(base({ id: "2", status: "doing", assigneeUserId: "other", dueOn: "2026-03-01" }), "2026-02-15"),
      withFlags(base({ id: "3", status: "done", assigneeUserId: "me", dueOn: "2026-02-01" }), "2026-02-15"),
    ];
    expect(filterTodos(rows, "all", "me").map((t) => t.id)).toEqual(["1", "2", "3"]);
    expect(filterTodos(rows, "mine", "me").map((t) => t.id)).toEqual(["1"]);
    expect(filterTodos(rows, "doing", "me").map((t) => t.id)).toEqual(["2"]);
    expect(filterTodos(rows, "overdue", "me").map((t) => t.id)).toEqual(["1"]);
    expect(filterTodos([], "all", "me")).toEqual([]);
  });

  it("builds deep links and empty-state next actions", () => {
    expect(todoDeepLink("org-1", "abc")).toBe("/todos?todoId=abc&orgId=org-1");
    const empty = todosNextActions({ orgId: "org-1", todoCount: 0, mineOpen: 0, overdue: 0 });
    expect(empty.map((a) => a.id)).toEqual(["add-first", "calendar", "messages", "practice"]);
    expect(empty.every((a) => !/demo/i.test(`${a.label} ${a.detail}`))).toBe(true);
    const setup = todosNextActions({ orgId: null, todoCount: 0, mineOpen: 0, overdue: 0 });
    expect(setup[0]?.id).toBe("workspace");
  });
});
