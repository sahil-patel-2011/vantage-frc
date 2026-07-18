/** Season recency weights — mode depends on strategy engine tier. */

export type SeasonWeightMode = "recency" | "this-season";

/**
 * Baseline (weighted-current-v1): current / prior / two-back = 1.0 / 0.55 / 0.30.
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
  if (age > 2) return 0;
  return age === 0 ? 1 : age === 1 ? 0.55 : 0.3;
}
