/**
 * Lovat Match Predictor math.
 *
 * Alliance score ~ Normal(sum of team means, sqrt(sum of team variances)).
 * Point differential = red − blue. P(blue wins) is the left tail at 0
 * (z-score → p-value). Teams without a real mean or spread are skipped —
 * never invent 0 or a default σ.
 */

export type TeamScoreSpread = {
  teamKey: string;
  mean: number;
  std: number;
};

export type AllianceScoreSpread = {
  mean: number;
  std: number;
  teams: TeamScoreSpread[];
};

export type LovatWinPrediction = {
  redPredicted: number;
  bluePredicted: number;
  redWinPct: number;
  blueWinPct: number;
  differentialMean: number;
  differentialStd: number;
};

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Abramowitz & Stegun 7.1.26 error-function approximation. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * abs);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-abs * abs);
  return sign * y;
}

/** Standard normal CDF Φ(z). */
export function standardNormalCdf(z: number): number {
  if (!Number.isFinite(z)) return Number.NaN;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function allianceScoreSpread(teams: TeamScoreSpread[]): AllianceScoreSpread | null {
  if (teams.length === 0) return null;
  for (const team of teams) {
    if (!Number.isFinite(team.mean) || !Number.isFinite(team.std) || team.std < 0) return null;
  }
  const mean = teams.reduce((sum, team) => sum + team.mean, 0);
  const variance = teams.reduce((sum, team) => sum + team.std * team.std, 0);
  return { mean: round2(mean), std: round4(Math.sqrt(variance)), teams };
}

/**
 * Lovat win % from alliance score spreads. Returns null when a spread is
 * missing or the differential has zero width (would look like a guarantee).
 */
export function lovatWinProbability(
  red: AllianceScoreSpread,
  blue: AllianceScoreSpread,
): LovatWinPrediction | null {
  const differentialMean = red.mean - blue.mean;
  const differentialStd = Math.sqrt(red.std * red.std + blue.std * blue.std);
  if (!Number.isFinite(differentialStd) || differentialStd <= 0) return null;
  const zAtZero = (0 - differentialMean) / differentialStd;
  const blueWinPct = round4(standardNormalCdf(zAtZero));
  if (!Number.isFinite(blueWinPct)) return null;
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
 * Predict an unscored match. Every listed robot must have a real mean.
 * `fieldStd` is this event's population spread — used only when a team has
 * no match-to-match std of its own. No field spread → predicted scores only.
 */
export function predictUnscoredMatch(input: {
  red: Array<{ teamKey: string; mean: number | null; std?: number | null }>;
  blue: Array<{ teamKey: string; mean: number | null; std?: number | null }>;
  fieldStd?: number | null;
}):
  | { redPredicted: number; bluePredicted: number; redWinPct: number | null; blueWinPct: number | null }
  | null {
  const toSpread = (
    rows: Array<{ teamKey: string; mean: number | null; std?: number | null }>,
  ): TeamScoreSpread[] | null => {
    const teams: TeamScoreSpread[] = [];
    for (const row of rows) {
      if (row.mean == null || !Number.isFinite(row.mean)) return null;
      const std = row.std != null && Number.isFinite(row.std) && row.std > 0 ? row.std : input.fieldStd;
      if (std == null || !Number.isFinite(std) || std <= 0) {
        return null;
      }
      teams.push({ teamKey: row.teamKey, mean: row.mean, std });
    }
    return teams;
  };

  if (input.red.length === 0 || input.blue.length === 0) return null;
  const redMeans: number[] = [];
  const blueMeans: number[] = [];
  for (const row of input.red) {
    if (row.mean == null || !Number.isFinite(row.mean)) return null;
    redMeans.push(row.mean);
  }
  for (const row of input.blue) {
    if (row.mean == null || !Number.isFinite(row.mean)) return null;
    blueMeans.push(row.mean);
  }

  const redPredicted = round2(redMeans.reduce((sum, value) => sum + value, 0));
  const bluePredicted = round2(blueMeans.reduce((sum, value) => sum + value, 0));

  const redSpread = toSpread(input.red);
  const blueSpread = toSpread(input.blue);
  if (!redSpread || !blueSpread) {
    return { redPredicted, bluePredicted, redWinPct: null, blueWinPct: null };
  }
  const redAlliance = allianceScoreSpread(redSpread);
  const blueAlliance = allianceScoreSpread(blueSpread);
  if (!redAlliance || !blueAlliance) {
    return { redPredicted, bluePredicted, redWinPct: null, blueWinPct: null };
  }
  const win = lovatWinProbability(redAlliance, blueAlliance);
  if (!win) {
    return { redPredicted, bluePredicted, redWinPct: null, blueWinPct: null };
  }
  return {
    redPredicted: win.redPredicted,
    bluePredicted: win.bluePredicted,
    redWinPct: win.redWinPct,
    blueWinPct: win.blueWinPct,
  };
}
