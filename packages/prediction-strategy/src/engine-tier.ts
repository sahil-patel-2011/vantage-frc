/**
 * Plan → strategy engine selection.
 * Free/BYOK and Access stay on the solid baseline; Pro deepens; Max is highest depth.
 * Never invents DEMO stats — engines only consume real season/scout inputs.
 */

export type StrategyEngineId =
  | "weighted-current-v1"
  | "strategy-engine-v2"
  | "strategy-engine-max-v1";

export type StrategyEngineTier = "baseline" | "pro" | "max";

export type StrategyEnginePolicy = {
  engineId: StrategyEngineId;
  tier: StrategyEngineTier;
  label: string;
  /** Relative reasoning depth (1 = baseline, 2 = pro, 3 = max). */
  depth: number;
  /** When true, only current-season EPA signals contribute. */
  thisSeasonOnly: boolean;
  /** Cap on scout blend into rating (0–1). */
  maxScoutBlend: number;
  /** Prefer Statbotics over TBA when both exist for the same team/year/event. */
  preferStatbotics: boolean;
  /** Emit EPA event-vs-year drift factors when both signals exist. */
  includeEpaDrift: boolean;
  /** Emit leave-one-out Δp factors for every alliance robot (not just leads). */
  fullLeaveOneOutFactors: boolean;
  /** Emit multi-step explainable reasoning notes (deterministic; optional AI deepen later). */
  extraReasoningSteps: boolean;
  /** Stronger scout quality weighting in foul/capability penalties. */
  scoutQualityEmphasis: boolean;
};

const BASELINE: StrategyEnginePolicy = {
  engineId: "weighted-current-v1",
  tier: "baseline",
  label: "Baseline (weighted-current-v1)",
  depth: 1,
  thisSeasonOnly: false,
  maxScoutBlend: 0.25,
  preferStatbotics: false,
  includeEpaDrift: false,
  fullLeaveOneOutFactors: false,
  extraReasoningSteps: false,
  scoutQualityEmphasis: false,
};

const PRO: StrategyEnginePolicy = {
  engineId: "strategy-engine-v2",
  tier: "pro",
  label: "Pro (strategy-engine-v2)",
  depth: 2,
  thisSeasonOnly: true,
  maxScoutBlend: 0.4,
  preferStatbotics: true,
  includeEpaDrift: false,
  fullLeaveOneOutFactors: false,
  extraReasoningSteps: false,
  scoutQualityEmphasis: true,
};

const MAX: StrategyEnginePolicy = {
  engineId: "strategy-engine-max-v1",
  tier: "max",
  label: "Max (strategy-engine-max-v1)",
  depth: 3,
  thisSeasonOnly: true,
  maxScoutBlend: 0.5,
  preferStatbotics: true,
  includeEpaDrift: true,
  fullLeaveOneOutFactors: true,
  extraReasoningSteps: true,
  scoutQualityEmphasis: true,
};

/**
 * Commercial plan codes → engine policy.
 *
 * Since the 0481 pricing ladder, EVERY plan — Free included — gets the full
 * engine: plans differ only in hosted AI allowance, never in feature depth.
 * Unknown/missing codes also get MAX so a plan-code typo can never silently
 * degrade a team's strategy maths.
 */
const PLAN_ENGINE: Record<string, StrategyEnginePolicy> = {
  free: MAX,
  pro: MAX,
  pro_plus: MAX,
  max: MAX,
  team_trial: MAX,
  // Legacy codes (aliased to the new ladder by packages/billing).
  access: MAX,
  individual_pro: MAX,
  team_pro: MAX,
  individual_max: MAX,
  team_max: MAX,
  managed_20: MAX,
  managed_50: MAX,
};

export function normalizePlanCode(planCode: string | null | undefined): string {
  return (planCode ?? "free").trim().toLowerCase() || "free";
}

/** Resolve engine policy from org billing plan code. */
export function selectStrategyEngine(
  planCode: string | null | undefined,
): StrategyEnginePolicy {
  const code = normalizePlanCode(planCode);
  return PLAN_ENGINE[code] ?? MAX;
}

export function strategyEnginePolicyForId(
  engineId: StrategyEngineId | null | undefined,
): StrategyEnginePolicy {
  if (engineId === "strategy-engine-max-v1") return MAX;
  if (engineId === "strategy-engine-v2") return PRO;
  return BASELINE;
}

/** Soft-UI / API summary of the active engine. */
export type StrategyEngineSummary = {
  id: StrategyEngineId;
  label: string;
  tier: StrategyEngineTier;
  planCode: string;
  depth: number;
  thisSeasonOnly: boolean;
};

export function toEngineSummary(
  policy: StrategyEnginePolicy,
  planCode: string | null | undefined,
): StrategyEngineSummary {
  return {
    id: policy.engineId,
    label: policy.label,
    tier: policy.tier,
    planCode: normalizePlanCode(planCode),
    depth: policy.depth,
    thisSeasonOnly: policy.thisSeasonOnly,
  };
}

/** Plan → engine id map for docs / tests. */
export const PLAN_TO_ENGINE_ID: Readonly<Record<string, StrategyEngineId>> = {
  free: "weighted-current-v1",
  access: "weighted-current-v1",
  individual_pro: "strategy-engine-v2",
  team_pro: "strategy-engine-v2",
  team_trial: "strategy-engine-v2",
  individual_max: "strategy-engine-max-v1",
  team_max: "strategy-engine-max-v1",
  managed_20: "weighted-current-v1",
  managed_50: "weighted-current-v1",
};
