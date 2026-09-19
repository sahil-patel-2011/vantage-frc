import {
  isScorePredictionSkip,
  matchPlanFromPrediction,
  predictAllianceScores,
  type ScorePredictionBasis,
  type ScoutedTeamRating,
  type TeamScoreFeatures,
} from "@vantage/prediction-strategy";

export type EpaMetricRow = {
  teamKey: string;
  autoEpa: number | null;
  teleopEpa: number | null;
  endgameEpa: number | null;
  opr?: number | null;
};

export type NextMatchScoreCard = {
  redPredicted: number;
  bluePredicted: number;
  errorBand: number;
  drivers: string[];
  briefing: string;
  auto: string;
  defend: string;
  climb: string;
  /** Where the number came from, so the card can say so. */
  basis: ScorePredictionBasis;
};

export function seasonYearFromEventKey(eventKey: string | null | undefined): number | null {
  if (!eventKey) return null;
  const year = Number(eventKey.slice(0, 4));
  return Number.isInteger(year) && year >= 1992 && year <= 2100 ? year : null;
}

export function featuresForAlliance(
  keys: string[],
  rows: readonly EpaMetricRow[],
  /**
   * This team's own scouting, keyed by team. Supplying it is what makes a
   * prediction possible at an event with no official numbers, and what lets
   * reliability and climb rate inform one that has them.
   */
  scouted?: ReadonlyMap<string, ScoutedTeamRating>,
): TeamScoreFeatures[] {
  const byKey = new Map(rows.map((row) => [row.teamKey, row]));
  return keys.map((teamKey) => {
    const row = byKey.get(teamKey);
    return {
      teamKey,
      autoEpa: row?.autoEpa ?? null,
      teleopEpa: row?.teleopEpa ?? null,
      endgameEpa: row?.endgameEpa ?? null,
      opr: row?.opr ?? null,
      scouted: scouted?.get(teamKey) ?? null,
    };
  });
}

/**
 * Honest alliance-score card, or a skip when there is nothing to predict from.
 *
 * "Nothing to predict from" now means no official rating *and* not enough of
 * this team's own scouting — which is the change that makes the card work at
 * an off-season event, where official ratings never arrive.
 */
export function nextMatchScoreCard(input: {
  matchKey: string;
  ourAlliance: "red" | "blue" | null;
  redKeys: string[];
  blueKeys: string[];
  rows: readonly EpaMetricRow[];
  scouted?: ReadonlyMap<string, ScoutedTeamRating>;
}): NextMatchScoreCard | { skipReason: string } {
  const prediction = predictAllianceScores({
    matchKey: input.matchKey,
    red: featuresForAlliance(input.redKeys, input.rows, input.scouted),
    blue: featuresForAlliance(input.blueKeys, input.rows, input.scouted),
  });
  if (isScorePredictionSkip(prediction)) {
    return { skipReason: prediction.skipReason };
  }
  const plan = matchPlanFromPrediction(prediction, input.ourAlliance);
  return {
    redPredicted: prediction.redPredicted,
    bluePredicted: prediction.bluePredicted,
    errorBand: prediction.errorBand,
    drivers: prediction.drivers,
    briefing: plan.briefing,
    auto: plan.auto,
    defend: plan.defend,
    climb: plan.climb,
    basis: prediction.basis,
  };
}

export function isNextMatchScoreSkip(
  value: NextMatchScoreCard | { skipReason: string },
): value is { skipReason: string } {
  return "skipReason" in value;
}
