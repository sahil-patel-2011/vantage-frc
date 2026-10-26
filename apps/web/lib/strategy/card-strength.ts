import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CARD_SCORE_MODEL, seasonPriorForEvent, type StrengthEvent, type StrengthRating, type TeamSeasonPrior } from "@vantage/prediction-strategy";

type StrengthFile = { events: StrengthEvent[]; ratings: StrengthRating[] };

let cached: StrengthFile | null | undefined;

function strengthFile(): StrengthFile | null {
  if (cached !== undefined) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  const file = "packages/prediction-strategy/test/fixtures/season-strength.json";
  const candidates = [
    join(here, "../../../../", file),
    join(here, "../../../", file),
    join(process.cwd(), file),
    join(process.cwd(), "../", file),
    join(process.cwd(), "../../", file),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    cached = JSON.parse(readFileSync(candidate, "utf8")) as StrengthFile;
    return cached;
  }
  cached = null;
  return null;
}

/** Priors whose event ended before `start`. Null when the file or the date is missing. */
export function priorForEvent(eventKey: string, start: string | null): Map<string, TeamSeasonPrior> | null {
  if (!start) return null;
  const file = strengthFile();
  if (!file) return null;
  const prior = seasonPriorForEvent({
    events: file.events,
    ratings: file.ratings,
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
