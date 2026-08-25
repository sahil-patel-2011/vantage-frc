/**
 * Turning one CAD tool call into one line of "what the agent just did".
 *
 * Every mutating tool in claude-cad.ts already returns a `narration` object
 * ({ title, detail }) written at the point where the real dimensions are known —
 * "Drilled 4× ⌀5 mm through holes", not "called onshape_hole". This module lifts
 * that verbatim into a step record the /cad session pane renders with per-step
 * status, and falls back to the tool's catalog label when a tool has no narration
 * of its own. Nothing here composes a dimension: if the tool did not say it, the
 * step does not claim it.
 *
 * Pure — no network, no DB. Shared by the hosted agent (apps/web/lib/cad) and any
 * terminal surface that wants the same wording.
 */

import { cadToolSpec } from "./cad-tool-catalog";

export type CadAgentStepStatus = "done" | "failed";

export type CadAgentStep = {
  /** 1-based position in the session log. */
  index: number;
  tool: string;
  /** Human tool name from the catalog ("Fillet"), for the step chip. */
  label: string;
  /** Verbatim narration title from the tool, else a plain fallback. */
  title: string;
  /** Verbatim narration detail, or the error message when the step failed. */
  detail: string;
  status: CadAgentStepStatus;
  /** Onshape feature this step created, when it made one. */
  featureId: string | null;
  at: string;
};

const MAX_TITLE = 200;
const MAX_DETAIL = 300;

function clip(value: string, max: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(source: Record<string, unknown> | null, key: string): string {
  const value = source?.[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Build one step from a tool call and its result.
 *
 * `ok=false` means the tool threw; the error text becomes the detail so a failed
 * step reads as a failed step rather than disappearing from the log.
 */
export function cadAgentStep(input: {
  index: number;
  tool: string;
  result: unknown;
  ok: boolean;
  at?: string;
}): CadAgentStep {
  const spec = cadToolSpec(input.tool);
  const result = asRecord(input.result);
  const narration = asRecord(result?.narration);
  const label = spec?.label ?? input.tool;
  const at = input.at ?? new Date().toISOString();

  if (!input.ok) {
    const error = readString(result, "error") || "The tool failed and nothing was changed.";
    return {
      index: input.index,
      tool: input.tool,
      label,
      title: `${label} failed`,
      detail: clip(error, MAX_DETAIL),
      status: "failed",
      featureId: null,
      at,
    };
  }

  // A tool can return ok:false in its body (the Fusion "unsupported" shape) without throwing.
  if (result?.ok === false) {
    const error = readString(result, "error") || `${label} did not run.`;
    return {
      index: input.index,
      tool: input.tool,
      label,
      title: `${label} did not run`,
      detail: clip(error, MAX_DETAIL),
      status: "failed",
      featureId: null,
      at,
    };
  }

  const title = readString(narration, "title");
  const detail = readString(narration, "detail");
  return {
    index: input.index,
    tool: input.tool,
    label,
    title: clip(title || (spec ? spec.label : input.tool), MAX_TITLE),
    detail: clip(detail, MAX_DETAIL),
    status: "done",
    featureId: readString(result, "featureId") || readString(result, "deletedFeatureId") || null,
    at,
  };
}

const STEP_STATUSES: readonly CadAgentStepStatus[] = ["done", "failed"];

/** Re-read persisted steps defensively — old rows and hand-edited JSON must not crash the pane. */
export function parseCadAgentSteps(raw: unknown, limit = 40): CadAgentStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: CadAgentStep[] = [];
  for (const entry of raw) {
    const row = asRecord(entry);
    if (!row) continue;
    const tool = readString(row, "tool");
    const status = readString(row, "status") as CadAgentStepStatus;
    if (!tool || !STEP_STATUSES.includes(status)) continue;
    const title = readString(row, "title");
    if (!title) continue;
    steps.push({
      index: steps.length + 1,
      tool,
      label: readString(row, "label") || cadToolSpec(tool)?.label || tool,
      title: clip(title, MAX_TITLE),
      detail: clip(readString(row, "detail"), MAX_DETAIL),
      status,
      featureId: readString(row, "featureId") || null,
      at: readString(row, "at") || new Date(0).toISOString(),
    });
  }
  // Keep the most recent window, then renumber so the pane always reads 1..n.
  return steps.slice(-limit).map((step, index) => ({ ...step, index: index + 1 }));
}

/** One-line summary for the chat transcript, so the text log matches the step list. */
export function summarizeCadAgentSteps(steps: readonly CadAgentStep[]): string {
  if (!steps.length) return "";
  const failed = steps.filter((step) => step.status === "failed").length;
  const built = steps.length - failed;
  return failed
    ? `${built} step${built === 1 ? "" : "s"} completed, ${failed} failed.`
    : `${built} step${built === 1 ? "" : "s"} completed.`;
}
