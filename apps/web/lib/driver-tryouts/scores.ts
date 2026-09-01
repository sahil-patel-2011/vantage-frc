// Rubric scores are integers 1–5 that an evaluator actually logged. Missing, non-integer,
// or out-of-range values are absent — never clamped, never defaulted to 0 or 1.

import {
  DRIVER_TRYOUTS_CRITERIA,
  type DriverTryoutsCriterion,
  type DriverTryoutsEvaluation,
} from "./types";

const round2 = (value: number) => Math.round(value * 100) / 100;

export type LoggedRubricScores = Record<DriverTryoutsCriterion, number>;

/** Integer 1–5 only. Empty / NaN / 0 / 6 / 3.4 are not scores. */
export function parseRubricScore(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
}

export function parseLoggedRubricScores(input: {
  scorePrecision: unknown;
  scoreAwareness: unknown;
  scoreCommunication: unknown;
  scoreComposure: unknown;
  scoreMechanical: unknown;
}): LoggedRubricScores | null {
  const precision = parseRubricScore(input.scorePrecision);
  const awareness = parseRubricScore(input.scoreAwareness);
  const communication = parseRubricScore(input.scoreCommunication);
  const composure = parseRubricScore(input.scoreComposure);
  const mechanical = parseRubricScore(input.scoreMechanical);
  if (
    precision == null ||
    awareness == null ||
    communication == null ||
    composure == null ||
    mechanical == null
  ) {
    return null;
  }
  return { precision, awareness, communication, composure, mechanical };
}

export function loggedScoresFromEvaluation(
  evaluation: DriverTryoutsEvaluation,
): LoggedRubricScores | null {
  return parseLoggedRubricScores(evaluation);
}

/**
 * Mean of each criterion across evaluations that have a full logged rubric.
 * Returns null when nothing has been scored — never a zero-filled average.
 */
export function averageLoggedScores(evaluations: DriverTryoutsEvaluation[]): {
  averages: LoggedRubricScores;
  overallAverage: number;
  loggedCount: number;
} | null {
  const logged = evaluations
    .map(loggedScoresFromEvaluation)
    .filter((scores): scores is LoggedRubricScores => scores != null);
  if (logged.length === 0) return null;

  const totals: LoggedRubricScores = {
    precision: 0,
    awareness: 0,
    communication: 0,
    composure: 0,
    mechanical: 0,
  };
  for (const scores of logged) {
    for (const criterion of DRIVER_TRYOUTS_CRITERIA) {
      totals[criterion] += scores[criterion];
    }
  }
  const n = logged.length;
  const averages: LoggedRubricScores = {
    precision: round2(totals.precision / n),
    awareness: round2(totals.awareness / n),
    communication: round2(totals.communication / n),
    composure: round2(totals.composure / n),
    mechanical: round2(totals.mechanical / n),
  };
  const overallAverage = round2(
    DRIVER_TRYOUTS_CRITERIA.reduce((sum, criterion) => sum + averages[criterion], 0) /
      DRIVER_TRYOUTS_CRITERIA.length,
  );
  return { averages, overallAverage, loggedCount: n };
}
