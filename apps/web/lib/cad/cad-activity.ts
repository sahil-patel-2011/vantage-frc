/**
 * Shaping for the /cad "Recent CAD activity" panel.
 *
 * Two pure pieces, so the route stays a query and the rules stay testable:
 *  - `cadActivityFilters` turns untrusted query strings into a narrow, closed set
 *    of predicates. A filter may only ever NARROW the RLS-scoped org query; there
 *    is no value that widens it, and anything unrecognised falls back to the
 *    safest reading rather than being interpolated into SQL.
 *  - `cadActivityDetailFrom` renders one session's steps for the expanded row,
 *    reading whichever shape that session stored: terminal sessions keep
 *    `brief.toolCalls` (migration 0451), web agent sessions keep `brief.steps`
 *    (packages/cad/src/cad-agent-steps.ts). Neither is invented when absent —
 *    an old session with no recorded steps says so.
 */

import { parseCadAgentSteps, type CadAgentStep } from "@vantage/cad";

export type CadActivityScope = "mine" | "all";
export type CadActivitySource = "all" | "web" | "terminal";

export type CadActivityFilters = {
  scope: CadActivityScope;
  source: CadActivitySource;
  /** Bound to a SQL boolean param — true adds `created_by = $userId`. */
  mineOnly: boolean;
  /** Bound to a SQL text param — null means "no source predicate". */
  sourceParam: "web" | "terminal" | null;
};

export function cadActivityFilters(input: {
  scope?: string | null;
  source?: string | null;
}): CadActivityFilters {
  // Default to the whole team: a CAD lead opening /cad wants to see what the
  // build team did, not only their own sessions.
  const scope: CadActivityScope = input.scope === "mine" ? "mine" : "all";
  const source: CadActivitySource =
    input.source === "web" || input.source === "terminal" ? input.source : "all";
  return {
    scope,
    source,
    mineOnly: scope === "mine",
    sourceParam: source === "all" ? null : source,
  };
}

export type CadActivityDetailStep = {
  index: number;
  tool: string;
  title: string;
  detail: string;
  status: "done" | "failed";
  at: string;
};

export type CadActivityDetail = {
  id: string;
  source: "terminal" | "web";
  status: string;
  documentName: string | null;
  documentUrl: string | null;
  steps: CadActivityDetailStep[];
  /** Honest empty-state copy when a session recorded no per-step data. */
  emptyReason: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(source: Record<string, unknown> | null, key: string): string {
  const value = source?.[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Terminal sessions log raw tool calls (`{ tool, params, at, ok, error }`).
 * Render them as steps without inventing a narration the CLI never wrote: the
 * title is the tool name, the detail is the recorded params or the real error.
 */
function stepsFromToolCalls(raw: unknown): CadActivityDetailStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: CadActivityDetailStep[] = [];
  for (const entry of raw) {
    const call = asRecord(entry);
    const tool = str(call, "tool");
    if (!tool) continue;
    const ok = call?.ok !== false;
    const params = asRecord(call?.params);
    const summary = params
      ? Object.entries(params)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(" · ")
      : "";
    steps.push({
      index: steps.length + 1,
      tool,
      title: tool,
      detail: ok ? summary : str(call, "error") || "Failed with no recorded error.",
      status: ok ? "done" : "failed",
      at: str(call, "at"),
    });
  }
  return steps;
}

function stepsFromAgentSteps(steps: CadAgentStep[]): CadActivityDetailStep[] {
  return steps.map((step) => ({
    index: step.index,
    tool: step.tool,
    title: step.title,
    detail: step.detail,
    status: step.status,
    at: step.at,
  }));
}

export function cadActivityDetailFrom(row: {
  id: string;
  kind: string | null;
  status: string;
  brief: unknown;
  document_ref: unknown;
}): CadActivityDetail {
  const brief = asRecord(row.brief);
  const documentRef = asRecord(row.document_ref);
  const source: "terminal" | "web" = row.kind === "cad_cli" ? "terminal" : "web";
  const steps =
    source === "terminal"
      ? stepsFromToolCalls(brief?.toolCalls)
      : stepsFromAgentSteps(parseCadAgentSteps(brief?.steps));
  return {
    id: row.id,
    source,
    status: row.status,
    documentName: str(documentRef, "documentName") || str(documentRef, "documentId") || null,
    documentUrl: str(documentRef, "url") || null,
    steps,
    emptyReason: steps.length
      ? null
      : source === "terminal"
        ? "This terminal session recorded no tool calls — it connected but never ran a CAD operation."
        : "This web session has no recorded build steps yet. Steps appear once the agent runs a CAD tool.",
  };
}
