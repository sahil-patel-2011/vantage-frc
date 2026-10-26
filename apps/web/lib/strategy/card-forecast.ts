import {
  CARD_MARGIN_SHARE,
  CARD_SCORE_MODEL,
  forecastMatch,
  type CategorySample,
  type MatchForecast,
  type MatchForecastSkip,
} from "@vantage/prediction-strategy";
import { priorForEvent } from "./card-strength";

/**
 * The next-match forecast. 2026 uses the prior model when the event has a
 * start date, because that model beat the in-event card on the held-out
 * matches. A missing date does not guess which events had already ended.
 */
export function forecastActiveMatch(input: {
  season: number;
  eventKey: string;
  startDate: string | null;
  level?: string;
  red: string[];
  blue: string[];
  played: readonly CategorySample[];
}): MatchForecast | MatchForecastSkip {
  const seasonPrior = input.season === 2026 ? priorForEvent(input.eventKey, input.startDate) : null;
  if (!seasonPrior) {
    return forecastMatch({
      season: input.season,
      red: input.red,
      blue: input.blue,
      played: input.played,
      level: input.level,
    });
  }
  return forecastMatch({
    season: input.season,
    red: input.red,
    blue: input.blue,
    played: input.played,
    spec: CARD_SCORE_MODEL,
    seasonPrior,
    level: input.level,
    marginShare: CARD_MARGIN_SHARE,
  });
}
