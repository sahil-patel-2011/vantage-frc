/**
 * Run planned native composer ops in order (sketch → extrude → verify, or
 * whatever the human staged). Pure helper — the caller injects execute.
 *
 * Empty plan → no calls. feature_script rejects the whole plan. First failure
 * stops the walk. Feature IDs come from prior execute results or the plan;
 * this helper never invents them.
 */

import {
  parseComposerOps,
  requireComposerDimensions,
  type ComposerNativeOp,
  type ComposerOp,
} from "./composer-ops";

export const COMPOSER_PLAN_FEATURE_SCRIPT =
  "feature_script is not a native composer operation";

export type ComposerPlanExecuteResult = {
  featureId?: string | null;
  externalFeatureId?: string | null;
};

export type ComposerPlanExecutor = (
  step: ComposerOp,
) => Promise<ComposerPlanExecuteResult | void>;

export type ComposerPlanStepRecord = {
  id: string;
  operation: ComposerNativeOp;
  status: "completed" | "failed";
  featureId?: string;
  error?: string;
};

export type ComposerPlanRun = {
  ok: boolean;
  completed: number;
  steps: ComposerPlanStepRecord[];
  error?: string;
};

const DEMO_FEATURE_ID = /demo/i;

export async function runComposerPlan(
  plan: unknown,
  execute: ComposerPlanExecutor,
): Promise<ComposerPlanRun> {
  if (planHasFeatureScript(plan)) {
    return { ok: false, completed: 0, steps: [], error: COMPOSER_PLAN_FEATURE_SCRIPT };
  }

  const ops = parseComposerOps(plan);
  if (ops.length === 0) {
    return { ok: true, completed: 0, steps: [] };
  }

  const steps: ComposerPlanStepRecord[] = [];
  let lastSketchFeatureId: string | undefined;

  for (const op of ops) {
    const parameters = parametersForExecute(op, lastSketchFeatureId);
    try {
      requireComposerDimensions(op.operation, parameters);
      const result = await execute({ ...op, parameters });
      const featureId = realReturnedId(result?.featureId) ?? realReturnedId(result?.externalFeatureId);
      steps.push({
        id: op.id,
        operation: op.operation,
        status: "completed",
        ...(featureId ? { featureId } : {}),
      });
      lastSketchFeatureId = rememberLastSketchFeatureId(op.operation, featureId, lastSketchFeatureId);
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : "Planned step failed";
      steps.push({
        id: op.id,
        operation: op.operation,
        status: "failed",
        error,
      });
      return { ok: false, completed: countCompleted(steps), steps, error };
    }
  }

  return { ok: true, completed: countCompleted(steps), steps };
}

function planHasFeatureScript(input: unknown): boolean {
  return rawPlanEntries(input).some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    return String((entry as { operation?: unknown }).operation ?? "") === "feature_script";
  });
}

function rawPlanEntries(input: unknown): unknown[] {
  if (input == null || input === "") return [];
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
    return rawPlanEntries(parsed);
  }
  if (Array.isArray(input)) return input;
  if (typeof input === "object") {
    const record = input as Record<string, unknown>;
    if (typeof record.operation === "string") return [input];
    const nested = record.steps ?? record.ops ?? record.plan ?? record.actions;
    if (nested == null || nested === "") return [];
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

/**
 * Fill create_extrude.sketchFeatureId only from a real prior sketch result.
 * Planned IDs stay as the human wrote them. Missing IDs stay missing.
 */
export function parametersForExecute(
  op: ComposerOp,
  lastSketchFeatureId: string | undefined,
): Record<string, unknown> {
  if (op.operation === "create_mate") {
    const firstFaceId = firstPlannedId(op.parameters.firstFaceId);
    const secondFaceId = firstPlannedId(op.parameters.secondFaceId);
    return {
      ...op.parameters,
      ...(firstFaceId ? { firstFaceId } : {}),
      ...(secondFaceId ? { secondFaceId } : {}),
    };
  }
  if (op.operation !== "create_extrude") return { ...op.parameters };
  const plannedSketch = firstPlannedId(op.parameters.sketchFeatureId);
  if (plannedSketch) {
    return { ...op.parameters, sketchFeatureId: plannedSketch };
  }
  if (!lastSketchFeatureId) return { ...op.parameters };
  return { ...op.parameters, sketchFeatureId: lastSketchFeatureId };
}

/** Keep a real create_sketch id for later extrude chaining. DEMO / blank stay current. */
export function rememberLastSketchFeatureId(
  operation: string,
  resultFeatureId: unknown,
  current: string | undefined,
): string | undefined {
  if (operation !== "create_sketch") return current;
  return realReturnedId(resultFeatureId) ?? current;
}

function firstPlannedId(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim());
    return typeof first === "string" ? first.trim() : "";
  }
  return "";
}

function hasPlannedId(value: unknown): boolean {
  return Boolean(firstPlannedId(value));
}

/** Accept only a real returned id. DEMO / blank / non-strings are not ids. */
function realReturnedId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  if (!id || DEMO_FEATURE_ID.test(id)) return undefined;
  return id;
}

function countCompleted(steps: readonly ComposerPlanStepRecord[]): number {
  return steps.filter((step) => step.status === "completed").length;
}
