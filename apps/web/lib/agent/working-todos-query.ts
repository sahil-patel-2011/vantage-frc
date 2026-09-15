import { WORKING_TODO_SCOPES, type WorkingTodoScope } from "@vantage/agent";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WorkingTodosQueryOk = {
  ok: true;
  orgId: string;
  runId: string;
  scope: WorkingTodoScope;
};

export type WorkingTodosQueryErr = {
  ok: false;
  error: string;
  status: number;
};

export type WorkingTodosQuery = WorkingTodosQueryOk | WorkingTodosQueryErr;

function asUuid(value: string | null, label: string): string | WorkingTodosQueryErr {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || !UUID_RE.test(trimmed)) {
    return { ok: false, error: `${label} is required`, status: 400 };
  }
  return trimmed;
}

export function parseWorkingTodosQuery(search: URLSearchParams): WorkingTodosQuery {
  const orgId = asUuid(search.get("orgId"), "orgId");
  if (typeof orgId !== "string") return orgId;
  const runId = asUuid(search.get("runId"), "runId");
  if (typeof runId !== "string") return runId;
  const rawScope = (search.get("scope") ?? "autonomous").trim() || "autonomous";
  if (!(WORKING_TODO_SCOPES as readonly string[]).includes(rawScope)) {
    return { ok: false, error: "scope is invalid", status: 400 };
  }
  return { ok: true, orgId, runId, scope: rawScope as WorkingTodoScope };
}
