import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import {
  isMissingWorkingTodosRelation,
  listWorkingTodos,
  listWorkingTodosResult,
  markWorkingTodoStatus,
  upsertSeedWorkingTodos,
  type WorkingTodoRow,
  type WorkingTodoScope,
  type WorkingTodoStatus,
} from "../src/working-todos";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";

type StoredTodo = WorkingTodoRow;

function nowIso() {
  return "2026-09-14T00:00:00.000Z";
}

function makeStoreClient(seed: StoredTodo[] = []) {
  const rows = seed.map((row) => ({ ...row }));
  const calls: { sql: string; params: unknown[] }[] = [];
  let seq = rows.length;

  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/FROM agent_working_todos/.test(sql) && /SELECT/.test(sql)) {
        const [orgId, userId, scope, runId] = params;
        const matched = rows
          .filter(
            (row) =>
              row.orgId === orgId &&
              row.userId === userId &&
              row.scope === scope &&
              (runId == null ? row.runId == null : row.runId === runId),
          )
          .sort((a, b) => a.sortKey - b.sortKey || a.createdAt.localeCompare(b.createdAt));
        return { rows: matched };
      }
      if (/INSERT INTO agent_working_todos/.test(sql)) {
        const [orgId, userId, scope, runId, label, status, sortKey] = params as [
          string,
          string,
          WorkingTodoScope,
          string | null,
          string,
          WorkingTodoStatus,
          number,
        ];
        seq += 1;
        const row: StoredTodo = {
          id: `todo-${seq}`,
          orgId,
          userId,
          scope,
          runId,
          label,
          status,
          sortKey,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        rows.push(row);
        return { rows: [row] };
      }
      if (/UPDATE agent_working_todos/.test(sql)) {
        const [todoId, orgId, userId, status] = params as [string, string, string, WorkingTodoStatus];
        const row = rows.find((item) => item.id === todoId && item.orgId === orgId && item.userId === userId);
        if (!row) return { rows: [] };
        row.status = status;
        row.updatedAt = "2026-09-14T00:01:00.000Z";
        return { rows: [row] };
      }
      return { rows: [] };
    }),
  } as unknown as PoolClient;

  return { client, rows, calls };
}

describe("listWorkingTodos", () => {
  it("lists a scope+run with parameterized uuid/text casts", async () => {
    const existing: StoredTodo = {
      id: "todo-1",
      orgId: ORG,
      userId: USER,
      scope: "autonomous",
      runId: RUN,
      label: "Pin the goal",
      status: "in_progress",
      sortKey: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const { client, calls } = makeStoreClient([existing]);
    const listed = await listWorkingTodos(client, {
      orgId: ORG,
      userId: USER,
      scope: "autonomous",
      runId: RUN,
    });
    expect(listed).toEqual([existing]);
    expect(calls[0]?.sql).toMatch(/org_id = \$1::uuid/);
    expect(calls[0]?.sql).toMatch(/user_id = \$2::uuid/);
    expect(calls[0]?.sql).toMatch(/scope = \$3::text/);
    expect(calls[0]?.sql).toMatch(/run_id IS NOT DISTINCT FROM \$4::uuid/);
    expect(calls[0]?.params).toEqual([ORG, USER, "autonomous", RUN]);
    expect(calls[0]?.sql).not.toContain(ORG);
  });

  it("classifies a missing table as setup, not an empty checklist", async () => {
    expect(isMissingWorkingTodosRelation(new Error('relation "agent_working_todos" does not exist'))).toBe(
      true,
    );
    expect(isMissingWorkingTodosRelation(new Error("undefined_table"))).toBe(true);
    expect(isMissingWorkingTodosRelation(new Error("connection refused"))).toBe(false);
    const client = {
      query: vi.fn(async () => {
        throw new Error('relation "agent_working_todos" does not exist');
      }),
    } as unknown as PoolClient;
    await expect(
      listWorkingTodosResult(client, { orgId: ORG, userId: USER, scope: "autonomous", runId: RUN }),
    ).resolves.toEqual({ ok: false, todos: [], setupRequired: true });
    await expect(
      listWorkingTodos(client, { orgId: ORG, userId: USER, scope: "autonomous", runId: RUN }),
    ).resolves.toEqual([]);
  });

  it("matches null run_id for chat-scoped todos", async () => {
    const chat: StoredTodo = {
      id: "todo-chat",
      orgId: ORG,
      userId: USER,
      scope: "chat",
      runId: null,
      label: "Cite the source",
      status: "pending",
      sortKey: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const otherRun: StoredTodo = { ...chat, id: "todo-run", runId: RUN, label: "Other" };
    const { client } = makeStoreClient([chat, otherRun]);
    const listed = await listWorkingTodos(client, {
      orgId: ORG,
      userId: USER,
      scope: "chat",
      runId: null,
    });
    expect(listed.map((row) => row.id)).toEqual(["todo-chat"]);
  });

  it("returns [] when the table is not migrated", async () => {
    const client = {
      query: vi.fn(async () => {
        throw Object.assign(new Error('relation "agent_working_todos" does not exist'), { code: "42P01" });
      }),
    } as unknown as PoolClient;
    await expect(
      listWorkingTodos(client, { orgId: ORG, userId: USER, scope: "cad" }),
    ).resolves.toEqual([]);
  });

  it("rejects an unknown scope before querying", async () => {
    const { client, calls } = makeStoreClient();
    await expect(
      listWorkingTodos(client, {
        orgId: ORG,
        userId: USER,
        scope: "eve" as WorkingTodoScope,
      }),
    ).rejects.toThrow(/invalid working-todo scope/);
    expect(calls).toHaveLength(0);
  });
});

describe("upsertSeedWorkingTodos", () => {
  it("inserts missing labels as pending and keeps existing status on resume", async () => {
    const existing: StoredTodo = {
      id: "todo-1",
      orgId: ORG,
      userId: USER,
      scope: "autonomous",
      runId: RUN,
      label: "Pin the goal",
      status: "done",
      sortKey: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const { client, calls, rows } = makeStoreClient([existing]);
    const listed = await upsertSeedWorkingTodos(client, {
      orgId: ORG,
      userId: USER,
      scope: "autonomous",
      runId: RUN,
      labels: ["Pin the goal", "  Open todos  ", "Pin the goal"],
    });
    expect(rows.map((row) => ({ label: row.label, status: row.status, sortKey: row.sortKey }))).toEqual([
      { label: "Pin the goal", status: "done", sortKey: 0 },
      { label: "Open todos", status: "pending", sortKey: 1 },
    ]);
    expect(listed.map((row) => row.label)).toEqual(["Pin the goal", "Open todos"]);
    const insert = calls.find((call) => /INSERT INTO agent_working_todos/.test(call.sql));
    expect(insert?.sql).toMatch(/\$1::uuid/);
    expect(insert?.sql).toMatch(/\$4::uuid/);
    expect(insert?.sql).toMatch(/\$7::integer/);
    expect(insert?.params).toEqual([ORG, USER, "autonomous", RUN, "Open todos", "pending", 1]);
    expect(insert?.sql).not.toContain("Open todos");
  });

  it("skips blank labels and does not invent rows", async () => {
    const { client, rows } = makeStoreClient();
    const listed = await upsertSeedWorkingTodos(client, {
      orgId: ORG,
      userId: USER,
      scope: "cad",
      runId: RUN,
      labels: ["   ", "\n", "Sketch the plate"],
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.label).toBe("Sketch the plate");
    expect(rows).toHaveLength(1);
  });
});

describe("markWorkingTodoStatus", () => {
  it("updates status with parameterized casts and returns the row", async () => {
    const existing: StoredTodo = {
      id: "todo-9",
      orgId: ORG,
      userId: USER,
      scope: "cad",
      runId: RUN,
      label: "Sketch the plate",
      status: "pending",
      sortKey: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const { client, calls } = makeStoreClient([existing]);
    const updated = await markWorkingTodoStatus(client, {
      orgId: ORG,
      userId: USER,
      todoId: "todo-9",
      status: "in_progress",
    });
    expect(updated?.status).toBe("in_progress");
    expect(calls[0]?.sql).toMatch(/SET status = \$4::text/);
    expect(calls[0]?.sql).toMatch(/id = \$1::uuid/);
    expect(calls[0]?.params).toEqual(["todo-9", ORG, USER, "in_progress"]);
    expect(calls[0]?.sql).not.toContain("todo-9");
  });

  it("returns null when the row is not owned / missing", async () => {
    const { client } = makeStoreClient();
    await expect(
      markWorkingTodoStatus(client, {
        orgId: ORG,
        userId: USER,
        todoId: "00000000-0000-4000-8000-000000000000",
        status: "blocked",
      }),
    ).resolves.toBeNull();
  });

  it("rejects an unknown status before querying", async () => {
    const { client, calls } = makeStoreClient();
    await expect(
      markWorkingTodoStatus(client, {
        orgId: ORG,
        userId: USER,
        todoId: "todo-9",
        status: "cancelled" as WorkingTodoStatus,
      }),
    ).rejects.toThrow(/invalid working-todo status/);
    expect(calls).toHaveLength(0);
  });
});
