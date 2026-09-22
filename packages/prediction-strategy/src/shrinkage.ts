/**
 * Trusting a number in proportion to how much of it there is.
 *
 * The engine treated a team with three matches exactly like a team with sixty.
 * Three matches is where the loudest numbers in FRC come from — a rookie who
 * drew two strong alliances leads the event on Friday morning, and every pick
 * list built that morning is wrong because of it. The error is not small and it
 * lands precisely when teams are making their most expensive decisions.
 *
 * The fix is the oldest one in the book: pull every estimate toward what the
 * field as a whole looks like, by an amount that depends on how thin the
 * evidence is. A team with sixty matches barely moves. A team with two moves a
 * long way, which is correct, because two matches genuinely does not tell you
 * much and pretending otherwise is the error.
 *
 * The amount of pull is not a taste setting. Given how much a team's own
 * matches vary and how much teams genuinely differ from one another, there is
 * a right answer, and `shrinkageConstant` estimates it from the data. When the
 * data cannot support an estimate this says so and falls back to a stated
 * prior, rather than quietly inventing a number and calling it maths.
 */

/**
 * Fallback pull, in matches, when variance is unavailable.
 *
 * Reads as: a team with this many matches sits halfway between its own number
 * and the field's. Eight is about a day of qualification play — the point at
 * which most people watching would start believing what they are seeing.
 * It is a stated prior, not a measurement, and `estimated: false` says so.
 */
export const DEFAULT_SHRINKAGE_MATCHES = 8;

/** Below this many teams there is no "field" to regress toward. */
export const MIN_FIELD_SIZE = 6;

/** Ignore this share at each end when taking the field's centre. */
const TRIM = 0.1;

export type TeamSample = {
  teamKey: string;
  /** The team's own observed rating. */
  rating: number;
  /** How many matches it rests on. */
  matches: number;
  /** Variance of this team's match-to-match contribution, when known. */
  variance?: number | null;
};

/**
 * The field's centre, trimmed.
 *
 * A plain mean is dragged by the same small-sample outliers this module exists
 * to correct, which would make the correction pull toward the noise.
 */
export function fieldCentre(ratings: readonly number[]): number | null {
  const usable = ratings.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!usable.length) return null;
  const cut = Math.floor(usable.length * TRIM);
  const kept = usable.length - 2 * cut >= 1 ? usable.slice(cut, usable.length - cut) : usable;
  return kept.reduce((sum, value) => sum + value, 0) / kept.length;
}

function variance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
}

export type ShrinkageConstant = {
  /** Pull, expressed in matches. Larger means trust the field more. */
  k: number;
  /** False when this is the stated prior rather than a measurement. */
  estimated: boolean;
  reason: string | null;
};

/**
 * How hard to pull, estimated from the field.
 *
 * The ratio of how much one team's matches vary to how much teams really
 * differ. When teams are all much the same, an unusual number is probably luck
 * and should be pulled hard. When teams genuinely differ, an unusual number is
 * probably real and should be left mostly alone.
 *
 * The subtraction in here is the part worth understanding: the spread you can
 * see between teams is inflated by sampling noise, so the true spread is the
 * observed spread minus the noise. Skipping that step is how a naive version
 * concludes teams differ enormously and then declines to shrink anything.
 */
export function shrinkageConstant(teams: readonly TeamSample[]): ShrinkageConstant {
  const fallback = (reason: string): ShrinkageConstant => ({
    k: DEFAULT_SHRINKAGE_MATCHES,
    estimated: false,
    reason,
  });

  const usable = teams.filter(
    (team) => Number.isFinite(team.rating) && Number.isFinite(team.matches) && team.matches > 0,
  );
  if (usable.length < MIN_FIELD_SIZE) {
    return fallback(`Needs at least ${MIN_FIELD_SIZE} teams to see a field; has ${usable.length}.`);
  }

  const withVariance = usable.filter(
    (team) => team.variance != null && Number.isFinite(team.variance) && team.variance >= 0,
  );
  if (withVariance.length < MIN_FIELD_SIZE) {
    return fallback("No match-to-match variance recorded, so the pull cannot be measured.");
  }

  const withinVariance =
    withVariance.reduce((sum, team) => sum + (team.variance as number), 0) / withVariance.length;

  const observedBetween = variance(usable.map((team) => team.rating));
  const meanSamplingVariance =
    usable.reduce((sum, team) => sum + withinVariance / team.matches, 0) / usable.length;
  const trueBetween = observedBetween - meanSamplingVariance;

  if (!(trueBetween > 0)) {
    // Every difference between these teams is explainable as noise. Pull hard —
    // but not infinitely, because the estimate itself is uncertain.
    return {
      k: 40,
      estimated: true,
      reason: "Teams here differ by no more than luck would explain, so ratings pull hard toward the field.",
    };
  }
  if (withinVariance <= 0) {
    return fallback("Recorded variance is zero, which no real match play produces.");
  }

  const k = withinVariance / trueBetween;
  return {
    k: Math.round(Math.min(200, Math.max(0.1, k)) * 100) / 100,
    estimated: true,
    reason: null,
  };
}

export type ShrunkRating = {
  teamKey: string;
  /** What the team's own matches said. */
  raw: number;
  /** What to actually use. */
  shrunk: number;
  /** How far it moved. Negative means the team was flattered by its record. */
  pull: number;
  matches: number;
  /** Share of the final number that came from the team itself, 0–1. */
  ownWeight: number;
};

/**
 * Pull every rating toward the field by the right amount for its sample.
 *
 * Returns the raw numbers untouched when there is no field to regress toward:
 * shrinking six teams toward their own average accomplishes nothing except
 * making them all look alike.
 */
export function shrinkRatings(
  teams: readonly TeamSample[],
  constant?: ShrinkageConstant,
): ShrunkRating[] {
  const usable = teams.filter(
    (team) => Number.isFinite(team.rating) && Number.isFinite(team.matches) && team.matches > 0,
  );
  const centre = fieldCentre(usable.map((team) => team.rating));
  const k = (constant ?? shrinkageConstant(usable)).k;

  return teams.map((team) => {
    const matches = Number.isFinite(team.matches) ? Math.max(0, team.matches) : 0;
    const raw = Number.isFinite(team.rating) ? team.rating : 0;
    if (centre == null || usable.length < MIN_FIELD_SIZE || matches <= 0) {
      return { teamKey: team.teamKey, raw, shrunk: raw, pull: 0, matches, ownWeight: 1 };
    }
    const ownWeight = matches / (matches + k);
    const shrunk = ownWeight * raw + (1 - ownWeight) * centre;
    return {
      teamKey: team.teamKey,
      raw,
      shrunk: Math.round(shrunk * 1000) / 1000,
      pull: Math.round((shrunk - raw) * 1000) / 1000,
      matches,
      ownWeight: Math.round(ownWeight * 1000) / 1000,
    };
  });
}

/**
 * One line explaining why a team's number moved, for the panel that shows it.
 * Silent when the move is too small to be worth a sentence.
 */
export function shrinkageNote(row: ShrunkRating): string | null {
  if (Math.abs(row.pull) < 0.5) return null;
  const direction = row.pull < 0 ? "down" : "up";
  return `Adjusted ${direction} ${Math.abs(row.pull).toFixed(1)} points: ${row.matches} match${row.matches === 1 ? "" : "es"} is a thin record, so this leans partly on how the field as a whole is playing.`;
}
