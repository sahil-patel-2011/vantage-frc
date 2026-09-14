import { populationStdDev, predictUnscoredMatch } from "@vantage/prediction-strategy";
import { isScored, type ScheduleMatch, type ScheduleMatchPrediction } from "../schedule-board";

export type { ScheduleMatchPrediction };

export function fieldStdFromRatings(ratings: Iterable<number>): number | null {
  return populationStdDev([...ratings].filter((value) => Number.isFinite(value)));
}

/**
 * Attach Lovat-style predicted scores (and win % when this event has a spread)
 * to unscored matches. Scored matches stay official-only. A match is skipped
 * when any alliance robot is missing a real rating.
 */
export function attachSchedulePredictions(
  matches: ScheduleMatch[],
  ratings: ReadonlyMap<string, number>,
  fieldStd: number | null,
): ScheduleMatch[] {
  return matches.map((match) => {
    if (isScored(match)) return { ...match, prediction: null };
    const prediction = predictUnscoredMatch({
      red: match.red.map((teamKey) => ({ teamKey, mean: ratings.get(teamKey) ?? null })),
      blue: match.blue.map((teamKey) => ({ teamKey, mean: ratings.get(teamKey) ?? null })),
      fieldStd,
    });
    return { ...match, prediction };
  });
}

export function formatSchedulePrediction(prediction: ScheduleMatchPrediction): string {
  const scores = `Est. ${Math.round(prediction.redPredicted)}–${Math.round(prediction.bluePredicted)}`;
  if (prediction.redWinPct == null || prediction.blueWinPct == null) return scores;
  const red = prediction.redWinPct >= prediction.blueWinPct;
  const pct = Math.round((red ? prediction.redWinPct : prediction.blueWinPct) * 100);
  return `${scores} · ${pct}% ${red ? "red" : "blue"}`;
}
