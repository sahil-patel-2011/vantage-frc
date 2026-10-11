/**
 * POST /api/todos (A5-01, A5-02, A5-22): a long title is refused rather than cut, View-only
 * members can't be assigned, only the people involved delete a task, and "today" is the
 * viewer's own date. The database is a fake that answers by SQL shape.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TODO_TITLE_TOO_LONG } from "../../../lib/todos/evaluate";
import { TODO_DELETE_REFUSED } from "../../../lib/todos/compute-todos";

const ORG = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const PARENT = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const TODO = "55555555-5555-4555-8555-555555555555";

type Query = { sql: string; params: unknown[] };

const state = vi.hoisted(() => ({
  myRole: "scout",
  todo: { createdBy: "", assigneeUserId: null as string | null } as { createdBy: string; assigneeUserId: string | null } | null,
  queries: [] as Query[],
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => ({ user: { id: "22222222-2222-4222-8222-222222222222" } }) } },
  emitPreferredNotification: async () => ({ emitted: true }),
  resolveAuthBaseURL: () => "http://localhost",
  sendCoachAssignmentEmail: async () => undefined,
  sendCoachTodoEmail: async () => undefined,
}));
vi.mock("@vantage/db", () => {
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      state.queries.push({ sql, params });
      if (sql.includes("SELECT role::text AS role FROM memberships")) {
        return { rowCount: 1, rows: [{ role: params[1] === PARENT ? "viewer" : "scout" }] };
      }
      if (sql.includes("SELECT 1 FROM memberships")) return { rowCount: 1, rows: [{}] };
      if (sql.includes(`t.created_by::text AS "createdBy"`)) {
        return state.todo ? { rowCount: 1, rows: [{ ...state.todo, role: state.myRole }] } : { rowCount: 0, rows: [] };
      }
      if (sql.includes("INSERT INTO team_todos")) return { rowCount: 1, rows: [{ id: TODO }] };
      if (sql.includes("DELETE FROM team_todos")) return { rowCount: 1, rows: [] };
      if (sql.includes("FROM memberships m") && sql.includes("JOIN organizations o")) {
        return { rowCount: 1, rows: [{ orgId: ORG, teamNumber: 6925 }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
  return {
    withRls: async (_context: unknown, work: (c: typeof client) => Promise<unknown>) => work(client),
    withSavepoint: async (_c: unknown, work: () => Promise<unknown>, fallback: unknown) => {
      try {
        return await work();
      } catch {
        return fallback;
      }
    },
  };
});

const { POST } = await import("./route");

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: ORG, ...body }),
    }),
  );
}

const writes = () => state.queries.filter((q) => /INSERT INTO team_todos|DELETE FROM team_todos|UPDATE team_todos/.test(q.sql));

beforeEach(() => {
  state.myRole = "scout";
  state.todo = { createdBy: OTHER, assigneeUserId: null };
  state.queries = [];
});

describe("adding a task", () => {
  it("refuses a title over 200 characters instead of cutting it mid-word", async () => {
    const response = await post({ action: "create-todo", title: "Long title word ".repeat(32) });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe(TODO_TITLE_TOO_LONG);
    expect(writes()).toEqual([]);
  });

  it("refuses a View-only member as the assignee", async () => {
    const response = await post({ action: "create-todo", title: "Pack the pit cart", assigneeUserId: PARENT });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/View-only members can't be given tasks/);
    expect(writes()).toEqual([]);
  });

  it("saves a normal task", async () => {
    const response = await post({ action: "create-todo", title: "Pack the pit cart", today: "2026-10-11" });
    expect(response.status).toBe(200);
    expect(writes()).toHaveLength(1);
  });
});

describe("deleting a task", () => {
  it("refuses someone who neither added it, holds it, nor leads the team", async () => {
    const response = await post({ action: "delete-todo", todoId: TODO });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe(TODO_DELETE_REFUSED);
    expect(writes()).toEqual([]);
  });

  it("lets the person it is assigned to delete it", async () => {
    state.todo = { createdBy: OTHER, assigneeUserId: ME };
    expect((await post({ action: "delete-todo", todoId: TODO })).status).toBe(200);
    expect(writes()).toHaveLength(1);
  });

  it("says plainly that a task was already deleted", async () => {
    state.todo = null;
    const response = await post({ action: "delete-todo", todoId: TODO });
    expect(((await response.json()) as { error: string }).error).toBe("That task was already deleted. The list is up to date now.");
  });
});
