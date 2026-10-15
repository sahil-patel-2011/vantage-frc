/** Season recency weights — mode depends on strategy engine tier. */

export type SeasonWeightMode = "recency" | "this-season";

/**
 * Ten seasons, each worth a little over half the one after it (×0.55), so this season leads,
 * last season counts about half, and a team's record from years back is a light prior: the
 * coaching, tooling and budget that carry over, not the robot. The first three are the weights
 * the engine has always used (1.0 / 0.55 / 0.30).
 */
export const SEASON_WEIGHTS = [1, 0.55, 0.3, 0.17, 0.09, 0.05, 0.03, 0.02, 0.01, 0.005] as const;
export const MAX_SEASONS_COUNTED = SEASON_WEIGHTS.length;

/**
 * Baseline (weighted-current-v2): the ten-season table above.
 * Pro/Max (this-season): only the active season contributes (kickoff/this-year rules).
 */
export function seasonWeight(
  currentYear: number,
  year: number,
  mode: SeasonWeightMode = "recency",
) {
  const age = currentYear - year;
  if (age < 0) return 0;
  if (mode === "this-season") return age === 0 ? 1 : 0;
  return SEASON_WEIGHTS[age] ?? 0;
}

/**
 * A season with two matches should not weigh the same as one with sixty, and a long past season
 * must not outvote this one on volume alone. Caps at 12 matches, about a qualification schedule.
 */
export function seasonSampleWeight(matches: number | null | undefined): number {
  if (matches == null || !Number.isFinite(matches)) return 1;
  if (matches <= 0) return 0;
  return Math.min(1, matches / 12);
}
