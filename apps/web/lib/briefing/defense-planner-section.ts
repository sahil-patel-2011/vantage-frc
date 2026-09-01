// Defense-planner matchups on the ONE pre-match briefing.
//
// /defense-planner writes defense_planner_matchups (migration 0203) — a computed recommendation
// against a scouted opponent. The briefing picks the newest stored plan per opponent in THIS
// match. No stored matchup means no row; TBA EPA never becomes a defense recommendation.

import type { BriefingDefensePlan } from "./types";

const RECOMMENDATIONS = new Set<BriefingDefensePlan["recommendation"]>([
  "play_defense",
  "stay_offense",
  "situational",
]);

const DEFENDERS = new Set<BriefingDefensePlan["assignedDefender"]>(["us", "none", "situational"]);

/** Row shape as read from defense_planner_matchups. */
export type DefensePlannerMatchupRow = {
  opponentTeamNumber: number | string;
  opponentTeamName: string | null;
  recommendation: string | null;
  assignedDefender: string | null;
  confidence: number | string | null;
  rationale: string | null;
  computedAt: string | null;
};

function recommendationOf(value: string | null): BriefingDefensePlan["recommendation"] | null {
  return value && RECOMMENDATIONS.has(value as BriefingDefensePlan["recommendation"])
    ? (value as BriefingDefensePlan["recommendation"])
    : null;
}

function defenderOf(value: string | null): BriefingDefensePlan["assignedDefender"] {
  return value && DEFENDERS.has(value as BriefingDefensePlan["assignedDefender"])
    ? (value as BriefingDefensePlan["assignedDefender"])
    : "situational";
}

/**
 * Newest usable defense plan per opponent in this match, in lineup order.
 *
 * `rows` may contain several seasons/recomputes for the same team; the first row seen for a
 * team number wins, so callers must pass them newest-first (SQL uses DISTINCT ON + updated_at
 * DESC). A row with an unknown recommendation is dropped rather than shown as invented advice.
 */
export function selectBriefingDefensePlans(
  rows: DefensePlannerMatchupRow[],
  opponentNumbers: number[],
): BriefingDefensePlan[] {
  const wanted = new Set(opponentNumbers.filter((value) => Number.isFinite(value) && value > 0));
  if (!wanted.size) return [];

  const seen = new Set<number>();
  const byOpponent = new Map<number, BriefingDefensePlan>();

  for (const row of rows) {
    const opponentTeamNumber = Number(row.opponentTeamNumber);
    if (!wanted.has(opponentTeamNumber) || seen.has(opponentTeamNumber)) continue;

    const recommendation = recommendationOf(row.recommendation);
    if (!recommendation) continue;
    seen.add(opponentTeamNumber);

    const confidence = Number(row.confidence);
    byOpponent.set(opponentTeamNumber, {
      opponentTeamNumber,
      opponentTeamName: (row.opponentTeamName ?? "").trim(),
      recommendation,
      assignedDefender: defenderOf(row.assignedDefender),
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
      rationale: (row.rationale ?? "").trim(),
      computedAt: row.computedAt ?? "",
    });
  }

  return opponentNumbers
    .map((number) => byOpponent.get(number))
    .filter((entry): entry is BriefingDefensePlan => Boolean(entry));
}
