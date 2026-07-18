export * from "./types";

import type { TrajectoryPoint, TrajectorySimulationInput, TrajectorySimulationResult } from "./types";

/** Deterministic-seedable PRNG (mulberry32) so tests can assert exact output. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number, mean: number, stdDev: number): number {
  // Box-Muller transform.
  const u1 = Math.max(rand(), 1e-9);
  const u2 = rand();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z0 * stdDev;
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function percentileOf(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = clamp(Math.round(p * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[idx] ?? 0;
}

/**
 * Approximate FRC district qualification-point scale: a team's per-event percentile within the
 * field (0..1, from EPA-derived win rate) maps to a 2..12 quals-points band, plus a smaller
 * playoff bonus band (0..8) weighted by the same percentile (alliance selection + elim rounds
 * are more likely, and go further, for stronger teams). This is a labeled approximation of the
 * real FIRST district point tables, not the official formula — it exists only to turn a
 * probability distribution into a points distribution for the simulator.
 */
function eventPointsForPercentile(percentile: number, rand: () => number): number {
  const qualPoints = 2 + 10 * percentile;
  const madeAlliance = rand() < clamp(0.15 + percentile * 0.7, 0, 0.95);
  let playoffPoints = 0;
  if (madeAlliance) {
    playoffPoints += 2; // selected onto an alliance
    for (let round = 0; round < 3; round += 1) {
      const wins = rand() < clamp(0.35 + percentile * 0.5, 0.05, 0.95);
      if (!wins) break;
      playoffPoints += 2;
    }
  }
  return qualPoints + playoffPoints;
}

/**
 * Monte-Carlo simulates remaining-event outcomes from a real EPA baseline and a real field
 * EPA distribution, producing a cumulative-points probability curve. `rand` is injectable for
 * deterministic tests; defaults to Math.random for production runs.
 */
export function runMonteCarloTrajectory(
  input: TrajectorySimulationInput,
  targetPoints: number | null = null,
  rand: () => number = Math.random,
): TrajectorySimulationResult {
  const simRuns = Math.max(1, Math.round(input.simRuns));
  const adjustedEpa = input.baselineEpa * (1 + (input.epaDeltaPct ?? 0));
  const fieldStdDev = input.fieldEpaStdDev > 0 ? input.fieldEpaStdDev : Math.max(1, Math.abs(input.fieldEpaMean) * 0.2);

  const totals: number[] = [];
  for (let run = 0; run < simRuns; run += 1) {
    let cumulative = 0;
    for (let event = 0; event < input.eventsRemaining; event += 1) {
      const performance = gaussian(rand, adjustedEpa, fieldStdDev * 0.15);
      const z = (performance - input.fieldEpaMean) / fieldStdDev;
      const percentile = clamp(sigmoid(z), 0.02, 0.98);
      cumulative += eventPointsForPercentile(percentile, rand);
    }
    totals.push(cumulative);
  }
  totals.sort((a, b) => a - b);

  const projectedPointsP10 = percentileOf(totals, 0.1);
  const projectedPointsP50 = percentileOf(totals, 0.5);
  const projectedPointsP90 = percentileOf(totals, 0.9);

  const pointsNeeded = targetPoints ?? (input.eventsRemaining > 0 ? projectedPointsP50 : null);
  const qualifyProbability =
    pointsNeeded == null || totals.length === 0
      ? 0
      : totals.filter((value) => value >= pointsNeeded).length / totals.length;

  const probabilityCurve = buildProbabilityCurve(totals);

  return {
    qualifyProbability,
    pointsNeeded,
    projectedPointsP10,
    projectedPointsP50,
    projectedPointsP90,
    probabilityCurve,
  };
}

/** Collapses the sorted run totals into up to 20 (points, cumulativeProbability) steps for a chart. */
export function buildProbabilityCurve(sortedTotals: number[]): TrajectoryPoint[] {
  if (sortedTotals.length === 0) return [];
  const steps = Math.min(20, sortedTotals.length);
  const curve: TrajectoryPoint[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const idx = Math.min(sortedTotals.length - 1, Math.round((i / steps) * sortedTotals.length) - 1);
    curve.push({
      points: Math.round((sortedTotals[idx] ?? 0) * 10) / 10,
      cumulativeProbability: Math.round((i / steps) * 100) / 100,
    });
  }
  return curve;
}
