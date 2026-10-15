/**
 * Putting a past season's rating on this season's scale.
 *
 * Every FRC game scores differently: a strong robot was worth ~30 points of EPA in one game and
 * ~60 in the next. Blending raw numbers across years averaged two different units. Instead each
 * season's rating is read as "how far above or below that year's field" (in standard deviations)
 * and placed at the same distance from this season's field.
 *
 * The field statistics come from every team's season rating (team_year_metrics), so they are
 * global, cheap to compute in one GROUP BY, and the same for every team.
 */

export type SeasonScale = {
  year: number;
  /** Mean season rating across the teams that played that year. */
  mean: number;
  /** Standard deviation of those ratings. */
  sd: number;
  /** How many teams the numbers came from. */
  teams: number;
};

/** Fewer teams than this and the year's mean/spread are too thin to rescale against. */
export const MIN_TEAMS_FOR_SCALE = 30;

function usable(scale: SeasonScale | undefined): scale is SeasonScale {
  return Boolean(
    scale &&
      Number.isFinite(scale.mean) &&
      Number.isFinite(scale.sd) &&
      scale.sd > 0 &&
      scale.teams >= MIN_TEAMS_FOR_SCALE,
  );
}

export function seasonScaleMap(scales: readonly SeasonScale[] | undefined): Map<number, SeasonScale> {
  const map = new Map<number, SeasonScale>();
  for (const scale of scales ?? []) if (usable(scale)) map.set(scale.year, scale);
  return map;
}

/**
 * The scale everything is expressed in: this season once enough teams have played, otherwise the
 * most recent season that has one (early January, before anyone has results). Null when there is
 * no usable scale at all, and then ratings are used as they are.
 */
export function referenceScale(scales: Map<number, SeasonScale>, currentYear: number): SeasonScale | null {
  const current = scales.get(currentYear);
  if (current) return current;
  let best: SeasonScale | null = null;
  for (const scale of scales.values()) {
    if (scale.year <= currentYear && (!best || scale.year > best.year)) best = scale;
  }
  return best;
}

/** How many standard deviations above (positive) or below that year's field. */
export function seasonZ(epa: number, scale: SeasonScale): number {
  return (epa - scale.mean) / scale.sd;
}

/**
 * A rating from `fromYear`, restated on the reference season's scale. Unchanged when either year
 * has no usable scale, so missing statistics never invent a number.
 */
export function rescaleRating(
  epa: number,
  fromYear: number,
  scales: Map<number, SeasonScale>,
  reference: SeasonScale | null,
): number {
  if (!reference || fromYear === reference.year) return epa;
  const from = scales.get(fromYear);
  if (!from) return epa;
  return reference.mean + seasonZ(epa, from) * reference.sd;
}

/**
 * Component ratings (auto, endgame) have no per-year spread of their own here, so they follow
 * the ratio of the two years' average total rating: a game that scores twice as much overall
 * roughly doubles the parts too.
 */
export function rescaleComponent(
  value: number,
  fromYear: number,
  scales: Map<number, SeasonScale>,
  reference: SeasonScale | null,
): number {
  if (!reference || fromYear === reference.year) return value;
  const from = scales.get(fromYear);
  if (!from || from.mean <= 0) return value;
  return value * (reference.mean / from.mean);
}

/** Share of a normal field below z: 0.5 at the mean, ~0.84 one standard deviation above. */
export function normalShareBelow(z: number): number {
  // Abramowitz–Stegun 7.1.26 erf approximation; plenty for "better than N% of teams".
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}
