// Driver tryouts rollups. Pure aggregation over candidates + evaluations — deterministic
// given its input, no clock, no I/O.

export * from "./types";
export {
  averageLoggedScores,
  loggedScoresFromEvaluation,
  parseLoggedRubricScores,
  parseRubricScore,
  type LoggedRubricScores,
} from "./scores";

import { averageLoggedScores, loggedScoresFromEvaluation } from "./scores";
import type {
  DriverTryoutsCandidate,
  DriverTryoutsCandidateScore,
  DriverTryoutsCriterion,
  DriverTryoutsEvaluation,
  DriverTryoutsReadiness,
  DriverTryoutsReadinessTier,
  DriverTryoutsRole,
  DriverTryoutsStatus,
  DriverTryoutsSummary,
} from "./types";

export const DRIVER_TRYOUTS_ROLES: DriverTryoutsRole[] = ["driver", "operator", "human_player", "any"];
export const DRIVER_TRYOUTS_STATUSES: DriverTryoutsStatus[] = ["active", "selected", "cut", "withdrawn"];

const round2 = (value: number) => Math.round(value * 100) / 100;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function driverTryoutsRoleLabel(role: DriverTryoutsRole): string {
  const labels: Record<DriverTryoutsRole, string> = {
    driver: "Driver",
    operator: "Operator",
    human_player: "Human player",
    any: "Any seat",
  };
  return labels[role];
}

export function driverTryoutsStatusLabel(status: DriverTryoutsStatus): string {
  const labels: Record<DriverTryoutsStatus, string> = {
    active: "Active",
    selected: "Selected",
    cut: "Cut",
    withdrawn: "Withdrawn",
  };
  return labels[status];
}

export function driverTryoutsCriterionLabel(criterion: DriverTryoutsCriterion): string {
  const labels: Record<DriverTryoutsCriterion, string> = {
    precision: "Driving precision",
    awareness: "Game awareness",
    communication: "Communication",
    composure: "Composure under pressure",
    mechanical: "Mechanical sympathy",
  };
  return labels[criterion];
}

/**
 * Aggregate candidates + their evaluations into per-candidate rubric averages, ranked by
 * overall average descending. Candidates with no logged scores still appear (rank null,
 * averages null) so the roster stays visible — zeros are never invented for them.
 */
export function summarizeDriverTryouts(
  candidates: DriverTryoutsCandidate[],
  evaluations: DriverTryoutsEvaluation[],
): DriverTryoutsSummary {
  const byCandidate = new Map<string, DriverTryoutsEvaluation[]>();
  for (const evaluation of evaluations) {
    if (!loggedScoresFromEvaluation(evaluation)) continue;
    const list = byCandidate.get(evaluation.candidateId) ?? [];
    list.push(evaluation);
    byCandidate.set(evaluation.candidateId, list);
  }

  const scored: Array<Omit<DriverTryoutsCandidateScore, "rank">> = candidates.map((candidate) => {
    const rolled = averageLoggedScores(byCandidate.get(candidate.id) ?? []);
    return {
      candidateId: candidate.id,
      candidate,
      evaluationCount: rolled?.loggedCount ?? 0,
      averages: rolled?.averages ?? null,
      overallAverage: rolled?.overallAverage ?? null,
    };
  });

  const ranked = [...scored].sort((a, b) => {
    if (a.overallAverage == null && b.overallAverage == null) return 0;
    if (a.overallAverage == null) return 1;
    if (b.overallAverage == null) return -1;
    return b.overallAverage - a.overallAverage;
  });
  const rankById = new Map<string, number>();
  let rank = 0;
  for (const entry of ranked) {
    if (entry.evaluationCount === 0) continue;
    rank += 1;
    rankById.set(entry.candidateId, rank);
  }

  const candidateScores: DriverTryoutsCandidateScore[] = scored
    .map((entry) => ({ ...entry, rank: rankById.get(entry.candidateId) ?? null }))
    .sort((a, b) => {
      if (a.rank == null && b.rank == null) return 0;
      if (a.rank == null) return 1;
      if (b.rank == null) return -1;
      return a.rank - b.rank;
    });

  return {
    totalCandidates: candidates.length,
    totalEvaluations: [...byCandidate.values()].reduce((n, list) => n + list.length, 0),
    evaluatedCandidates: scored.filter((row) => row.evaluationCount > 0).length,
    candidateScores,
  };
}

function tierFor(score: number): DriverTryoutsReadinessTier {
  if (score >= 0.66) return "ready";
  if (score > 0) return "in_progress";
  return "not_started";
}

/**
 * Selection readiness: never fabricated — an empty roster or unscored candidates read as
 * "not_started". Rewards breadth (every candidate scored at least once) and depth (multiple
 * evaluators per candidate, reducing single-rater bias).
 */
export function computeDriverTryoutsReadiness(
  summary: DriverTryoutsSummary,
  targetEvaluatorsPerCandidate = 2,
): DriverTryoutsReadiness {
  if (summary.totalCandidates === 0) {
    return {
      score: 0,
      tier: "not_started",
      candidatesFullyEvaluated: 0,
      recommendations: ["Add candidates trying out for the drive team to start scoring."],
    };
  }

  const breadth = clamp01(summary.evaluatedCandidates / summary.totalCandidates);
  const candidatesFullyEvaluated = summary.candidateScores.filter(
    (row) => row.evaluationCount >= targetEvaluatorsPerCandidate,
  ).length;
  const depth = clamp01(candidatesFullyEvaluated / summary.totalCandidates);
  const score = round2(0.5 * breadth + 0.5 * depth);

  const recommendations: string[] = [];
  if (breadth < 1) {
    recommendations.push(
      `${summary.totalCandidates - summary.evaluatedCandidates} candidate(s) have no scores yet — evaluate every candidate before selecting.`,
    );
  }
  if (depth < 1) {
    recommendations.push(
      `Get at least ${targetEvaluatorsPerCandidate} evaluators per candidate to reduce single-rater bias.`,
    );
  }
  if (recommendations.length === 0) {
    recommendations.push("Every candidate has enough independent scores — the ranking is ready to inform selection.");
  }

  return { score, tier: tierFor(score), candidatesFullyEvaluated, recommendations };
}
