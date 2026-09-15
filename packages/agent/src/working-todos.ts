/**
 * Durable working-memory todos (agent_working_todos).
 * Parameterized SQL only — callers pass the request PoolClient from withRls.
 */

import type { PoolClient } from "@neondatabase/serverless";

export const WORKING_TODO_SCOPES = ["autonomous", "cad", "chat"] as const;
export type WorkingTodoScope = (typeof WORKING_TODO_SCOPES)[number];

export const WORKING_TODO_STATUSES = ["pending", "in_progress", "done", "blocked"] as const;
export type WorkingTodoStatus = (typeof WORKING_TODO_STATUSES)[number];

export const MAX_WORKING_TODO_LABEL_CHARS = 500;

export type WorkingTodoRow = {
  id: string;
  orgId: string;
  userId: string;
  scope: WorkingTodoScope;
  runId: string | null;
  label: string;
  status: WorkingTodoStatus;
  sortKey: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkingTodoScopeKey = {
  orgId: string;
  userId: string;
  scope: WorkingTodoScope;
  runId?: string | null;
};

const TODO_SELECT = `id, org_id AS "orgId", user_id AS "userId", scope,
       run_id AS "runId", label, status, sort_key AS "sortKey",
       created_at AS "createdAt", updated_at AS "updatedAt"`;

function assertWorkingTodoScope(scope: string): asserts scope is WorkingTodoScope {
  if ((WORKING_TODO_SCOPES as readonly string[]).includes(scope)) return;
  throw new Error(`invalid working-todo scope: ${scope}`);
}

function assertWorkingTodoStatus(status: string): asserts status is WorkingTodoStatus {
  if ((WORKING_TODO_STATUSES as readonly string[]).includes(status)) return;
  throw new Error(`invalid working-todo status: ${status}`);
}

function normalizeLabel(label: string): string | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_WORKING_TODO_LABEL_CHARS
    ? trimmed.slice(0, MAX_WORKING_TODO_LABEL_CHARS)
    : trimmed;
}

function scopeRunParams(input: WorkingTodoScopeKey): [string, string, WorkingTodoScope, string | null] {
  assertWorkingTodoScope(input.scope);
  return [input.orgId, input.userId, input.scope, input.runId ?? null];
}

function mapTodoRow(row: WorkingTodoRow): WorkingTodoRow {
  return {
    ...row,
    runId: row.runId ?? null,
    sortKey: Number(row.sortKey),
  };
}

export function isMissingWorkingTodosRelation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /agent_working_todos|undefined_table|does not exist/i.test(message);
}

export type WorkingTodosListResult =
  | { ok: true; todos: WorkingTodoRow[]; setupRequired: false }
  | { ok: false; todos: []; setupRequired: true };

export async function listWorkingTodosResult(
  client: PoolClient,
  input: WorkingTodoScopeKey,
): Promise<WorkingTodosListResult> {
  const params = scopeRunParams(input);
  try {
    const result = await client.query<WorkingTodoRow>(
      `SELECT ${TODO_SELECT}
         FROM agent_working_todos
        WHERE org_id = $1::uuid
          AND user_id = $2::uuid
          AND scope = $3::text
          AND run_id IS NOT DISTINCT FROM $4::uuid
        ORDER BY sort_key ASC, created_at ASC`,
      params,
    );
    return { ok: true, todos: result.rows.map(mapTodoRow), setupRequired: false };
  } catch (error) {
    if (isMissingWorkingTodosRelation(error)) {
      return { ok: false, todos: [], setupRequired: true };
    }
    throw error;
  }
}

export async function listWorkingTodos(
  client: PoolClient,
  input: WorkingTodoScopeKey,
): Promise<WorkingTodoRow[]> {
  try {
    return (await listWorkingTodosResult(client, input)).todos;
  } catch (error) {
    if (error instanceof Error && /invalid working-todo (scope|status)/.test(error.message)) {
      throw error;
    }
    // Unknown query failure — callers show empty/setup, never invented todos.
    return [];
  }
}

export async function upsertSeedWorkingTodos(
  client: PoolClient,
  input: WorkingTodoScopeKey & { labels: readonly string[] },
): Promise<WorkingTodoRow[]> {
  const existing = await listWorkingTodos(client, input);
  const have = new Set(existing.map((row) => row.label));
  let nextKey = existing.reduce((max, row) => Math.max(max, row.sortKey), -1) + 1;
  const [orgId, userId, scope, runId] = scopeRunParams(input);

  for (const raw of input.labels) {
    const label = normalizeLabel(raw);
    if (!label || have.has(label)) continue;
    await client.query(
      `INSERT INTO agent_working_todos (
         org_id, user_id, scope, run_id, label, status, sort_key
       ) VALUES (
         $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::text, $7::integer
       )`,
      [orgId, userId, scope, runId, label, "pending", nextKey],
    );
    have.add(label);
    nextKey += 1;
  }

  return listWorkingTodos(client, input);
}

export async function markWorkingTodoStatus(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    todoId: string;
    status: WorkingTodoStatus;
  },
): Promise<WorkingTodoRow | null> {
  assertWorkingTodoStatus(input.status);
  const result = await client.query<WorkingTodoRow>(
    `UPDATE agent_working_todos
        SET status = $4::text, updated_at = now()
      WHERE id = $1::uuid
        AND org_id = $2::uuid
        AND user_id = $3::uuid
      RETURNING ${TODO_SELECT}`,
    [input.todoId, input.orgId, input.userId, input.status],
  );
  const row = result.rows[0];
  return row ? mapTodoRow(row) : null;
}
