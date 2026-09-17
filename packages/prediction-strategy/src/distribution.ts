/**
 * What a team's numbers look like, not just what they average to.
 *
 * Every scouting figure in the product was a mean. Two teams both averaging ten
 * points are not the same team: one scores ten every match and the other scores
 * nothing twice and twenty twice. For a third-round pick where you need a floor
 * under you, the first is worth far more. For a longshot where only a ceiling
 * saves the match, the second might be. A single number cannot tell those
 * apart, and alliance selection is mostly that question.
 *
 * The spread here is deliberately the robust kind — quartiles rather than
 * standard deviation. One dead battery in twelve matches is a reliability
 * problem, tracked separately, and it should not get a team labelled
 * boom-or-bust. A standard deviation would do exactly that; an interquartile
 * range shrugs it off.
 *
 * The other half of the job is refusing to answer. Percentiles of four matches
 * are noise with decimal places, and a confident "steady" from a sample that
 * small is worse than no label at all, because someone will pick on it.
 */

/** Below this, quartiles describe the sample and not the team. */
export const MIN_FOR_SPREAD = 6;

/** Below this, even a median is worth hedging. */
export const MIN_FOR_CENTRE = 3;

export type Consistency = "metronome" | "steady" | "streaky" | "boom-or-bust" | "unknown";

export type Distribution = {
  n: number;
  mean: number;
  median: number;
  /** 25th percentile: roughly what you can count on. */
  floor: number | null;
  /** 75th percentile: roughly the good day. */
  ceiling: number | null;
  min: number;
  max: number;
  /** Interquartile range, null when the sample is too thin to have one. */
  iqr: number | null;
  /**
   * Spread relative to the middle. Null when there is no usable median to
   * divide by, which is a real case: a team that has scored zero all event.
   */
  dispersion: number | null;
  consistency: Consistency;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Linear-interpolated percentile over sorted values.
 *
 * Interpolating rather than taking the nearest rank matters at these sample
 * sizes: with seven matches the nearest-rank 25th percentile is just the second
 * value, which jumps around alarmingly as one more match comes in.
 */
function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return Number.NaN;
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function consistencyFrom(dispersion: number | null, n: number): Consistency {
  if (n < MIN_FOR_SPREAD || dispersion == null) return "unknown";
  if (dispersion < 0.15) return "metronome";
  if (dispersion < 0.35) return "steady";
  if (dispersion < 0.6) return "streaky";
  return "boom-or-bust";
}

/**
 * Summarise a team's match-by-match numbers.
 *
 * Returns null for an empty sample rather than a distribution of zeros: a team
 * nobody has scouted and a team that has scored nothing are different facts,
 * and rendering them identically is how a pick list gets built on an absence.
 */
export function summariseDistribution(values: readonly number[]): Distribution | null {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) return null;

  const sorted = [...usable].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  const median = percentile(sorted, 0.5);

  const hasSpread = n >= MIN_FOR_SPREAD;
  const floor = hasSpread ? percentile(sorted, 0.25) : null;
  const ceiling = hasSpread ? percentile(sorted, 0.75) : null;
  const iqr = floor != null && ceiling != null ? ceiling - floor : null;

  // Dividing by the median keeps this comparable between a team that scores 5
  // and a team that scores 50. A median at or below zero has no scale to be
  // relative to, so there is no honest answer rather than a large one.
  const dispersion = iqr != null && median > 0 ? iqr / median : null;

  return {
    n,
    mean: round2(mean),
    median: round2(median),
    floor: floor == null ? null : round2(floor),
    ceiling: ceiling == null ? null : round2(ceiling),
    min: round2(sorted[0]!),
    max: round2(sorted[n - 1]!),
    iqr: iqr == null ? null : round2(iqr),
    dispersion: dispersion == null ? null : round2(dispersion),
    consistency: consistencyFrom(dispersion, n),
  };
}

export const CONSISTENCY_LABEL: Record<Consistency, string> = {
  metronome: "Metronome",
  steady: "Steady",
  streaky: "Streaky",
  "boom-or-bust": "Boom or bust",
  unknown: "Not enough matches",
};

/** One sentence a drive team can act on. Says the sample size, always. */
export function describeDistribution(distribution: Distribution): string {
  if (distribution.consistency === "unknown") {
    return `${distribution.n} match${distribution.n === 1 ? "" : "es"} scouted — too few to say whether that average holds up.`;
  }
  const floor = distribution.floor ?? distribution.min;
  const ceiling = distribution.ceiling ?? distribution.max;
  switch (distribution.consistency) {
    case "metronome":
      return `Does the same thing every time: ${floor} to ${ceiling} across ${distribution.n} matches.`;
    case "steady":
      return `Fairly reliable — usually between ${floor} and ${ceiling} over ${distribution.n} matches.`;
    case "streaky":
      return `Varies a lot: anywhere from ${floor} to ${ceiling} across ${distribution.n} matches. The average flatters the bad days.`;
    case "boom-or-bust":
      return `Wildly inconsistent — ${distribution.min} at worst and ${distribution.max} at best over ${distribution.n} matches. The average describes no match they actually played.`;
  }
}

export type PickNeed = "floor" | "ceiling";

export type PickComparison = {
  /** Team key of the better fit, or null when it is genuinely too close. */
  preferred: string | null;
  reason: string;
};

/**
 * Which of two teams fits what you need.
 *
 * The comparison depends entirely on the question, which is why it takes one.
 * A second pick that has to not lose you matches wants a floor. A longshot that
 * has to steal one wants a ceiling. Asking "who is better" without saying which
 * is how a good team gets picked into a role it is wrong for.
 */
export function comparePick(
  a: { teamKey: string; distribution: Distribution },
  b: { teamKey: string; distribution: Distribution },
  need: PickNeed,
): PickComparison {
  const thin = a.distribution.consistency === "unknown" || b.distribution.consistency === "unknown";
  if (thin) {
    return {
      preferred: null,
      reason: "One of these has too few matches to compare on anything but the average.",
    };
  }

  const valueOf = (distribution: Distribution) =>
    need === "floor" ? (distribution.floor ?? distribution.min) : (distribution.ceiling ?? distribution.max);
  const aValue = valueOf(a.distribution);
  const bValue = valueOf(b.distribution);
  const gap = Math.abs(aValue - bValue);
  const scale = Math.max(Math.abs(aValue), Math.abs(bValue), 1);

  // Under a twentieth of the larger number, scouting noise decides this, not
  // the robots. Naming a winner there is false precision.
  if (gap / scale < 0.05) {
    return {
      preferred: null,
      reason: `Too close to call on ${need === "floor" ? "their worst days" : "their best days"}.`,
    };
  }

  const winner = aValue > bValue ? a : b;
  const loser = aValue > bValue ? b : a;
  const word = need === "floor" ? "bad day" : "good day";
  return {
    preferred: winner.teamKey,
    reason: `${winner.teamKey.replace(/^frc/i, "")} is worth ${round2(gap)} more on a ${word} than ${loser.teamKey.replace(/^frc/i, "")}.`,
  };
}
