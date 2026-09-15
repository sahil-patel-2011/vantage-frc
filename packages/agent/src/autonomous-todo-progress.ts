/**
 * Mark working todos after an autonomous tool hop.
 * Done is only accepted from explicit model JSON — never invented from a loose match.
 */

import type { PoolClient } from "@neondatabase/serverless";
import {
  listWorkingTodos,
  markWorkingTodoStatus,
  type WorkingTodoRow,
  type WorkingTodoStatus,
} from "./working-todos";

export type TodoProgressMark = {
  todoId: string;
  status: Extract<WorkingTodoStatus, "done" | "in_progress" | "blocked">;
};

const MARKABLE_STATUSES = ["done", "in_progress", "blocked"] as const;

function isMarkableStatus(value: string): value is TodoProgressMark["status"] {
  return (MARKABLE_STATUSES as readonly string[]).includes(value);
}

export function normalizeTodoLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, " ").trim();
}

export function extractFirstJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function collectTodoUpdateNodes(payload: Record<string, unknown> | null): unknown[] {
  if (!payload) return [];
  const nodes: unknown[] = [payload.todos, payload.todoUpdates, payload.workingTodos, payload.todo];
  const input = payload.input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    nodes.push(record.todos, record.todoUpdates, record.todo);
  }
  return nodes.filter((node) => node != null);
}

function flattenTodoUpdates(nodes: unknown[]): Array<{ id?: string; label?: string; status?: string }> {
  const out: Array<{ id?: string; label?: string; status?: string }> = [];
  for (const node of nodes) {
    const list = Array.isArray(node) ? node : [node];
    for (const item of list) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim() : undefined;
      const label =
        typeof record.label === "string"
          ? record.label
          : typeof record.task === "string"
            ? record.task
            : undefined;
      const status = typeof record.status === "string" ? record.status.trim() : undefined;
      if (id || label || status) out.push({ id, label, status });
    }
  }
  return out;
}

function matchTodo(
  todos: readonly Pick<WorkingTodoRow, "id" | "label">[],
  update: { id?: string; label?: string },
): Pick<WorkingTodoRow, "id" | "label"> | undefined {
  if (update.id) {
    const byId = todos.find((todo) => todo.id === update.id);
    if (byId) return byId;
  }
  if (!update.label) return undefined;
  const wanted = normalizeTodoLabel(update.label);
  if (wanted.length < 8) return undefined;
  return todos.find((todo) => normalizeTodoLabel(todo.label) === wanted);
}

export function collectExplicitTodoMarks(
  payload: Record<string, unknown> | null,
  todos: readonly Pick<WorkingTodoRow, "id" | "label" | "status">[],
): TodoProgressMark[] {
  const marks: TodoProgressMark[] = [];
  const seen = new Set<string>();
  for (const update of flattenTodoUpdates(collectTodoUpdateNodes(payload))) {
    if (!update.status || !isMarkableStatus(update.status)) continue;
    const todo = matchTodo(todos, update);
    if (!todo || seen.has(todo.id)) continue;
    seen.add(todo.id);
    marks.push({ todoId: todo.id, status: update.status });
  }
  return marks;
}

export function conservativeTodoMarksFromTool(input: {
  todos: readonly Pick<WorkingTodoRow, "id" | "label" | "status">[];
  toolName: string;
  toolInput: Record<string, unknown>;
  toolSummary?: string;
}): TodoProgressMark[] {
  const haystack = normalizeTodoLabel(
    `${input.toolName} ${safeJson(input.toolInput)} ${input.toolSummary ?? ""}`,
  );
  const marks: TodoProgressMark[] = [];
  for (const todo of input.todos) {
    if (todo.status === "done") continue;
    const label = normalizeTodoLabel(todo.label);
    if (label.length < 8) continue;
    if (!haystack.includes(label)) continue;
    marks.push({ todoId: todo.id, status: "in_progress" });
  }
  return marks;
}

export function mergeTodoMarks(
  explicit: readonly TodoProgressMark[],
  inferred: readonly TodoProgressMark[],
): TodoProgressMark[] {
  const byId = new Map<string, TodoProgressMark>();
  for (const mark of inferred) {
    if (mark.status === "done") continue;
    byId.set(mark.todoId, mark);
  }
  for (const mark of explicit) {
    byId.set(mark.todoId, mark);
  }
  return [...byId.values()];
}

export async function applyWorkingTodoProgressAfterTool(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    runId: string;
    rawModelText: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    toolSummary?: string;
  },
): Promise<TodoProgressMark[]> {
  let todos: WorkingTodoRow[];
  try {
    todos = await listWorkingTodos(client, {
      orgId: input.orgId,
      userId: input.userId,
      scope: "autonomous",
      runId: input.runId,
    });
  } catch {
    return [];
  }
  if (!todos.length) return [];

  const payload = extractFirstJsonObject(input.rawModelText);
  const marks = mergeTodoMarks(
    collectExplicitTodoMarks(payload, todos),
    conservativeTodoMarksFromTool({
      todos,
      toolName: input.toolName,
      toolInput: input.toolInput,
      toolSummary: input.toolSummary,
    }),
  );

  const applied: TodoProgressMark[] = [];
  for (const mark of marks) {
    const current = todos.find((todo) => todo.id === mark.todoId);
    if (!current || current.status === "done") continue;
    if (current.status === mark.status) continue;
    try {
      const updated = await markWorkingTodoStatus(client, {
        orgId: input.orgId,
        userId: input.userId,
        todoId: mark.todoId,
        status: mark.status,
      });
      if (updated) applied.push(mark);
    } catch {
      break;
    }
  }
  return applied;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}
