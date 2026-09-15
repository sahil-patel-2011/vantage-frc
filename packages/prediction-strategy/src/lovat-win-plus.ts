/**
 * Slightly better than Lovat’s independent Normal win % — still never invents
 * a team mean or σ. Lovat is the base. Extra accuracy only from:
 * 1) a tighter Φ (Cody–Hart erf, not 7.1.26),
 * 2) measured partner correlation when the caller has it,
 * 3) Platt slope/intercept from real outcomes,
 * 4) a small-sample temperature that widens overconfident p when n is tiny.
 */

import {
  allianceScoreSpread,
  lovatWinProbability,
  type AllianceScoreSpread,
  type LovatWinPrediction,
  type TeamScoreSpread,
} from "./lovat-win";

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Cody–Hart rational erf. Same shape as Abramowitz–Stegun, tighter in the
 * tails Lovat’s 7.1.26 under-reads (~1.96σ and beyond).
 */
export function erfCodyHart(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const poly =
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t);
  const base = 1 - poly * Math.exp(-z * z);
  if (z < 1.5) return sign * base;
  const t2 = 1 / (1 + 0.47047 * z);
  const tail =
    1 -
    ((0.3480242 * t2 - 0.0958798) * t2 + 0.7478556) * t2 * Math.exp(-z * z);
  const mix = Math.min(1, (z - 1.5) / 1.5);
  return sign * ((1 - mix) * base + mix * tail);
}

export function standardNormalCdfPlus(z: number): number {
  if (!Number.isFinite(z)) return Number.NaN;
  return 0.5 * (1 + erfCodyHart(z / Math.SQRT2));
}

export type WinPlusOptions = {
  /** Measured within-alliance residual correlation in (-1, 1). Omit = independent (Lovat). */
  partnerCorr?: number | null;
  /** Platt a,b from real match outcomes: p' = Φ(a * Φ⁻¹(p) + b). Identity if omitted. */
  platt?: { a: number; b: number } | null;
  /** How many robots on the card — used only to widen tiny-n overconfidence. */
  robotCount?: number;
};

function clampCorr(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.85, Math.max(-0.85, value));
}

/**
 * Alliance σ with optional pairwise correlation. Independent teams (ρ = 0)
 * match Lovat’s √Σσ². Positive ρ raises alliance variance — FRC partners
 * share field congestion — only when ρ was measured.
 */
export function allianceStdWithCorr(teams: TeamScoreSpread[], partnerCorr?: number | null): number | null {
  if (!teams.length) return null;
  let variance = 0;
  for (const team of teams) {
    if (!Number.isFinite(team.std) || team.std < 0) return null;
    variance += team.std * team.std;
  }
  const rho = partnerCorr == null ? 0 : clampCorr(partnerCorr);
  if (rho !== 0 && teams.length > 1) {
    for (let i = 0; i < teams.length; i += 1) {
      for (let j = i + 1; j < teams.length; j += 1) {
        variance += 2 * rho * teams[i].std * teams[j].std;
      }
    }
  }
  if (variance <= 0) return null;
  return Math.sqrt(variance);
}

/** Widen σ when the card has few robots so 99% calls need more evidence. */
export function smallSampleTemperature(robotCount: number | undefined): number {
  if (robotCount == null || !Number.isFinite(robotCount) || robotCount >= 6) return 1;
  if (robotCount <= 0) return 1;
  return Math.sqrt(1 + 2 / Math.max(1, robotCount));
}

export function applyPlatt(p: number, platt?: { a: number; b: number } | null): number {
  if (!platt || !Number.isFinite(platt.a) || !Number.isFinite(platt.b)) return p;
  if (platt.a === 1 && platt.b === 0) return p;
  const z = inverseNormApprox(p);
  if (!Number.isFinite(z)) return p;
  return standardNormalCdfPlus(platt.a * z + platt.b);
}

/** Beasley–Springer / Moro-ish inverse-norm for (0,1). */
function inverseNormApprox(p: number): number {
  const clipped = Math.min(1 - 1e-12, Math.max(1e-12, p));
  if (clipped === 0.5) return 0;
  const sign = clipped < 0.5 ? -1 : 1;
  const r = clipped < 0.5 ? clipped : 1 - clipped;
  const t = Math.sqrt(-2 * Math.log(r));
  const c0 = 2.515517;
  const c1 = 0.802853;
  const c2 = 0.010328;
  const d1 = 1.432788;
  const d2 = 0.189269;
  const d3 = 0.001308;
  const z = t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
  return sign * z;
}

export function lovatWinProbabilityPlus(
  red: AllianceScoreSpread,
  blue: AllianceScoreSpread,
  options?: WinPlusOptions,
): LovatWinPrediction | null {
  const rho = options?.partnerCorr;
  const redStd = allianceStdWithCorr(red.teams, rho);
  const blueStd = allianceStdWithCorr(blue.teams, rho);
  if (redStd == null || blueStd == null) return null;
  const temperature = smallSampleTemperature(options?.robotCount ?? red.teams.length + blue.teams.length);
  const differentialMean = red.mean - blue.mean;
  const differentialStd = Math.sqrt(redStd * redStd + blueStd * blueStd) * temperature;
  if (!Number.isFinite(differentialStd) || differentialStd <= 0) return null;
  const zAtZero = (0 - differentialMean) / differentialStd;
  let blueWinPct = round4(standardNormalCdfPlus(zAtZero));
  if (!Number.isFinite(blueWinPct)) return null;
  blueWinPct = round4(Math.min(0.999, Math.max(0.001, applyPlatt(blueWinPct, options?.platt))));
  return {
    redPredicted: round2(red.mean),
    bluePredicted: round2(blue.mean),
    redWinPct: round4(1 - blueWinPct),
    blueWinPct,
    differentialMean: round4(differentialMean),
    differentialStd: round4(differentialStd),
  };
}

/**
 * Recency mean: only blends when both the event rating and a last-N mean exist.
 * Weight last-N by n / (n + k), k = 4. Missing side is unused — never 0-fill.
 */
export function blendEventAndRecentMean(
  eventMean: number | null | undefined,
  recentMean: number | null | undefined,
  recentN: number | null | undefined,
): number | null {
  const eventOk = eventMean != null && Number.isFinite(eventMean);
  const recentOk = recentMean != null && Number.isFinite(recentMean);
  if (!eventOk && !recentOk) return null;
  if (!eventOk) return recentOk ? recentMean! : null;
  if (!recentOk || recentN == null || !Number.isFinite(recentN) || recentN <= 0) return eventMean!;
  const w = recentN / (recentN + 4);
  return (1 - w) * eventMean! + w * recentMean!;
}

export function predictUnscoredMatchPlus(input: {
  red: Array<{ teamKey: string; mean: number | null; std?: number | null; recentMean?: number | null; recentN?: number | null }>;
  blue: Array<{ teamKey: string; mean: number | null; std?: number | null; recentMean?: number | null; recentN?: number | null }>;
  fieldStd?: number | null;
  partnerCorr?: number | null;
  platt?: { a: number; b: number } | null;
}):
  | { redPredicted: number; bluePredicted: number; redWinPct: number | null; blueWinPct: number | null }
  | null {
  const resolveMean = (
    row: { mean: number | null; recentMean?: number | null; recentN?: number | null },
  ): number | null => blendEventAndRecentMean(row.mean, row.recentMean, row.recentN);

  if (input.red.length === 0 || input.blue.length === 0) return null;
  const redMeans: number[] = [];
  const blueMeans: number[] = [];
  for (const row of input.red) {
    const mean = resolveMean(row);
    if (mean == null) return null;
    redMeans.push(mean);
  }
  for (const row of input.blue) {
    const mean = resolveMean(row);
    if (mean == null) return null;
    blueMeans.push(mean);
  }

  const redPredicted = round2(redMeans.reduce((sum, value) => sum + value, 0));
  const bluePredicted = round2(blueMeans.reduce((sum, value) => sum + value, 0));

  const toSpread = (
    rows: Array<{ teamKey: string; mean: number | null; std?: number | null; recentMean?: number | null; recentN?: number | null }>,
    means: number[],
  ): TeamScoreSpread[] | null => {
    const teams: TeamScoreSpread[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const std = row.std != null && Number.isFinite(row.std) && row.std > 0 ? row.std : input.fieldStd;
      if (std == null || !Number.isFinite(std) || std <= 0) return null;
      teams.push({ teamKey: row.teamKey, mean: means[i], std });
    }
    return teams;
  };

  const redSpread = toSpread(input.red, redMeans);
  const blueSpread = toSpread(input.blue, blueMeans);
  if (!redSpread || !blueSpread) {
    return { redPredicted, bluePredicted, redWinPct: null, blueWinPct: null };
  }
  const redAlliance = allianceScoreSpread(redSpread);
  const blueAlliance = allianceScoreSpread(blueSpread);
  if (!redAlliance || !blueAlliance) {
    return { redPredicted, bluePredicted, redWinPct: null, blueWinPct: null };
  }
  const win = lovatWinProbabilityPlus(redAlliance, blueAlliance, {
    partnerCorr: input.partnerCorr,
    platt: input.platt,
    robotCount: redSpread.length + blueSpread.length,
  });
  if (!win) {
    const fallback = lovatWinProbability(redAlliance, blueAlliance);
    if (!fallback) return { redPredicted, bluePredicted, redWinPct: null, blueWinPct: null };
    return {
      redPredicted: fallback.redPredicted,
      bluePredicted: fallback.bluePredicted,
      redWinPct: fallback.redWinPct,
      blueWinPct: fallback.blueWinPct,
    };
  }
  return {
    redPredicted: win.redPredicted,
    bluePredicted: win.bluePredicted,
    redWinPct: win.redWinPct,
    blueWinPct: win.blueWinPct,
  };
}
