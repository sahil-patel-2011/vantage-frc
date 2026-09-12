// On-demand briefing prediction refresh.
//
// Same path as GET /api/strategy?refresh=1: recomputeStrategyView re-runs
// predictMatch against the Neon TBA/Statbotics cache and finalizes so empty
// EPA stays empty (never a 50% guess). compute-briefing calls this once when
// input.refresh is set.

import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db";
import { normalizePlan, type BriefingPlan, type BriefingPrediction } from "../briefing";
import {
  finalizeStrategyRecompute,
  isEmptyEpaCoinFlip,
  recomputeStrategyView,
} from "../strategy/recompute";
import type { StrategyView } from "../strategy/types";
import { studentRatingLabel } from "../ui/student-rating-label";
import { normalizePlanOperations, normalizePlanTendencies } from "./plan-sections";
import type { BriefingScoutedTeam, BriefingTendency } from "./types";

export type BriefingPredictionRefreshInput = {
  userId: string;
  orgId: string;
  matchKey: string;
};

export type BriefingStrategySections = {
  prediction: BriefingPrediction | null;
  plan: BriefingPlan | null;
  scouted: BriefingScoutedTeam[];
  tendencies: BriefingTendency[];
};

function keyFactorsOf(value: unknown): BriefingPrediction["keyFactors"] {
  if (!Array.isArray(value)) return [];
  const factors: BriefingPrediction["keyFactors"] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) continue;
    const impact = Number(record.impact);
    factors.push({
      name: studentRatingLabel(name),
      alliance: typeof record.alliance === "string" ? record.alliance : "",
      impact: Number.isFinite(impact) ? impact : 0,
      evidence: studentRatingLabel(typeof record.evidence === "string" ? record.evidence : ""),
    });
  }
  return factors.slice(0, 6);
}

function caveatsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map(studentRatingLabel)
    .slice(0, 8);
}

/**
 * Map a strategy recompute into briefing sections.
 * Empty / setup / empty-EPA views stay empty — never a fabricated 50/50.
 */
export function briefingSectionsFromStrategyView(view: StrategyView): BriefingStrategySections | null {
  const finalized = finalizeStrategyRecompute(view);
  if (finalized.status !== "live") return null;
  if (isEmptyEpaCoinFlip(finalized.prediction, finalized.sources)) return null;

  const planJson = {
    playbook: finalized.playbook,
    tendencies: finalized.tendencies,
    operations: finalized.operations,
  };
  return {
    prediction: {
      pRed: finalized.prediction.pRed,
      pBlue: finalized.prediction.pBlue,
      confidenceLow: finalized.prediction.confidenceLow,
      confidenceHigh: finalized.prediction.confidenceHigh,
      modelVersion: finalized.prediction.modelVersion,
      keyFactors: keyFactorsOf(finalized.prediction.keyFactors),
      caveats: caveatsOf(finalized.prediction.caveats),
      scoredAt: finalized.computedAt,
    },
    plan: normalizePlan(planJson),
    scouted: normalizePlanOperations(planJson),
    tendencies: normalizePlanTendencies(planJson),
  };
}

/**
 * Re-run predictMatch the same way /api/strategy?refresh=1 does.
 * Failures and empty EPA degrade to null so the briefing keeps last-good
 * stored rows (or stays empty) instead of inventing a win rate.
 */
export async function refreshBriefingPrediction(
  client: PoolClient,
  input: BriefingPredictionRefreshInput,
): Promise<BriefingStrategySections | null> {
  // recomputeStrategyView persists as it goes, so a failure part-way leaves the
  // shared transaction aborted. Degrading to null is right; doing it without a
  // savepoint also emptied the stored rows the briefing falls back to.
  return withSavepoint(
    client,
    async () => {
      const view = await recomputeStrategyView(client, {
        userId: input.userId,
        requestedOrg: input.orgId,
        matchKey: input.matchKey,
      });
      return briefingSectionsFromStrategyView(view);
    },
    null,
  );
}
