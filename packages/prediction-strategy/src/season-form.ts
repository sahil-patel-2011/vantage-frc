/**
 * Blending a team's past seasons into one number, with this season dominant.
 *
 * FRC rebuilds the game every January, so a rating from three years ago is not
 * evidence about this robot — a different game, usually a different drivetrain,
 * and most of the students have graduated. But it is not nothing either: a team
 * with a decade of strong seasons has coaching, tooling and a parts budget that
 * do carry over.
 *
 * So history is included and weighted down hard. The weight halves every
 * DEFAULT_HALF_LIFE_YEARS, which puts last season at a quarter of this one and
 * anything past about five years into the noise. It is a prior, not a
 * prediction — the moment this season has real matches, this season is roughly
 * three quarters of the number.
 */

export type SeasonRating = {
  year: number;
  /** The team's rating for that season. Any consistent scale. */
  rating: number;
  /** Matches behind the rating, when known. Thin seasons count for less. */
  matches?: number | null;
};

export type WeightedForm = {
  /** The blended rating. */
  rating: number;
  /** Share of the total weight that came from the current season, 0–1. */
  currentSeasonShare: number;
  /** How many seasons actually contributed. */
  seasonsUsed: number;
};

/**
 * Halving every six months. In season terms: last season carries a quarter of
 * this season's weight, two back a sixteenth, and five back about one part in a
 * thousand.
 *
 * A slower decay was tried first (1.5 years) and rejected — it gave last season
 * 63% of this season's weight, which is not a light prior, it is co-authorship.
 * A different game with different students does not get a vote that size.
 */
export const DEFAULT_HALF_LIFE_YEARS = 0.5;

/** Beyond this the weight is under 2% and only adds arithmetic. */
export const MAX_SEASONS_BACK = 10;

/**
 * A season with two matches should not weigh the same as one with sixty. Caps
 * at 12 — about a qualification schedule — so a long season does not dominate
 * purely on volume.
 */
function sampleWeight(matches: number | null | undefined): number {
  if (matches == null || !Number.isFinite(matches)) return 1;
  if (matches <= 0) return 0;
  return Math.min(1, matches / 12);
}

/**
 * Blend seasons into one rating.
 *
 * Returns null rather than a number when nothing usable is supplied — an
 * invented rating is worse than an empty cell, and every caller here has an
 * empty state to show instead.
 */
export function weightedSeasonForm(
  seasons: SeasonRating[],
  currentYear: number,
  halfLifeYears: number = DEFAULT_HALF_LIFE_YEARS,
): WeightedForm | null {
  if (!Number.isFinite(currentYear)) return null;
  const halfLife = Number.isFinite(halfLifeYears) && halfLifeYears > 0 ? halfLifeYears : DEFAULT_HALF_LIFE_YEARS;

  let totalWeight = 0;
  let weightedSum = 0;
  let currentWeight = 0;
  let seasonsUsed = 0;

  for (const season of seasons) {
    if (!Number.isFinite(season.year) || !Number.isFinite(season.rating)) continue;
    const age = currentYear - season.year;
    // A season from the future is a data error, not a signal.
    if (age < 0 || age > MAX_SEASONS_BACK) continue;
    const weight = Math.pow(0.5, age / halfLife) * sampleWeight(season.matches);
    if (weight <= 0) continue;
    totalWeight += weight;
    weightedSum += weight * season.rating;
    if (age === 0) currentWeight += weight;
    seasonsUsed += 1;
  }

  if (totalWeight <= 0 || seasonsUsed === 0) return null;

  return {
    rating: Math.round((weightedSum / totalWeight) * 100) / 100,
    currentSeasonShare: Math.round((currentWeight / totalWeight) * 1000) / 1000,
    seasonsUsed,
  };
}

/**
 * One line saying how much of the number is this season, so nobody reads a
 * history-heavy blend as a measurement of the current robot.
 */
export function formProvenance(form: WeightedForm | null): string {
  if (!form) return "No season ratings yet.";
  const pct = Math.round(form.currentSeasonShare * 100);
  if (form.seasonsUsed === 1) {
    return pct === 100 ? "This season only." : "One past season, no results yet this year.";
  }
  if (pct >= 80) return `Mostly this season (${pct}%), with ${form.seasonsUsed - 1} earlier counted lightly.`;
  if (pct === 0) return `No results yet this season — this is ${form.seasonsUsed} past ${form.seasonsUsed === 1 ? "season" : "seasons"}, weighted down.`;
  return `${pct}% this season, the rest from ${form.seasonsUsed - 1} earlier ${form.seasonsUsed - 1 === 1 ? "season" : "seasons"}.`;
}
