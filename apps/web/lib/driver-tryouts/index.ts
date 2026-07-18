// Driver tryouts rollups. Pure aggregation over candidates + evaluations — deterministic
// given its input, no clock, no I/O.

export * from "./types";

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
export const DRIVER_TRYOUTS_CRITERIA: DriverTryoutsCriterion[] = [
  "precision",
  "awareness",
  "communication",
  "composure",
  "mechanical",
];

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

function evaluationAverages(evaluations: DriverTryoutsEvaluation[]): Record<DriverTryoutsCriterion, number> {
  if (evaluations.length === 0) {
    return { precision: 0, awareness: 0, communication: 0, composure: 0, mechanical: 0 };
  }
  const totals = { precision: 0, awareness: 0, communication: 0, composure: 0, mechanical: 0 };
  for (const evaluation of evaluations) {
    totals.precision += evaluation.scorePrecision;
    totals.awareness += evaluation.scoreAwareness;
    totals.communication += evaluation.scoreCommunication;
    totals.composure += evaluation.scoreComposure;
    totals.mechanical += evaluation.scoreMechanical;
  }
  const n = evaluations.length;
  return {
    precision: round2(totals.precision / n),
    awareness: round2(totals.awareness / n),
    communication: round2(totals.communication / n),
    composure: round2(totals.composure / n),
    mechanical: round2(totals.mechanical / n),
  };
}

/**
 * Aggregate candidates + their evaluations into per-candidate rubric averages, ranked by
 * overall average descending. Candidates with no evaluations yet still appear (rank null,
 * all-zero averages) so the roster stays visible while scoring is in progress.
 */
export function summarizeDriverTryouts(
  candidates: DriverTryoutsCandidate[],
  evaluations: DriverTryoutsEvaluation[],
): DriverTryoutsSummary {
  const byCandidate = new Map<string, DriverTryoutsEvaluation[]>();
  for (const evaluation of evaluations) {
    const list = byCandidate.get(evaluation.candidateId) ?? [];
    list.push(evaluation);
    byCandidate.set(evaluation.candidateId, list);
  }

  const scored: Array<Omit<DriverTryoutsCandidateScore, "rank">> = candidates.map((candidate) => {
    const candidateEvaluations = byCandidate.get(candidate.id) ?? [];
    const averages = evaluationAverages(candidateEvaluations);
    const overallAverage =
      candidateEvaluations.length === 0
        ? 0
        : round2(
            (averages.precision +
              averages.awareness +
              averages.communication +
              averages.composure +
              averages.mechanical) /
              5,
          );
    return {
      candidateId: candidate.id,
      candidate,
      evaluationCount: candidateEvaluations.length,
      averages,
      overallAverage,
    };
  });

  const ranked = [...scored].sort((a, b) => b.overallAverage - a.overallAverage);
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
    totalEvaluations: evaluations.length,
    evaluatedCandidates: byCandidate.size,
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
