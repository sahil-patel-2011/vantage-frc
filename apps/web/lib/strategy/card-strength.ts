import { CARD_SCORE_MODEL, seasonPriorForEvent, type StrengthEvent, type StrengthRating, type TeamSeasonPrior } from "@vantage/prediction-strategy";
import strengthJson from "../../../../packages/prediction-strategy/test/fixtures/season-strength.json";

type StrengthFile = { events: StrengthEvent[]; ratings: StrengthRating[] };

const strengthFile = strengthJson as StrengthFile;

/**
 * Priors whose event ended before `start`. Null when the date is missing.
 * The ratings file is imported here so the server bundle carries it. It is
 * not re-exported from the prediction package, which the browser also imports.
 */
export function priorForEvent(eventKey: string, start: string | null): Map<string, TeamSeasonPrior> | null {
  if (!start) return null;
  const prior = seasonPriorForEvent({
    events: strengthFile.events,
    ratings: strengthFile.ratings,
    eventKey,
    start,
    seasonDecay: CARD_SCORE_MODEL.seasonDecay ?? 0.45,
  });
  return prior.size ? prior : null;
}

export function eventStartIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") return /^(\d{4}-\d{2}-\d{2})/.exec(value)?.[1] ?? null;
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString().slice(0, 10);
}
