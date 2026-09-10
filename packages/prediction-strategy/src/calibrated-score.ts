/**
 * Calibrated alliance-score regressor.
 *
 * Predicts red/blue alliance totals from EPA components, recent-form, OPR
 * family stats, and this team's scouting. No match is scored when the inputs
 * are missing — the caller gets `skipReason` instead of a made-up number.
 *
 * The ±3 target is a product goal, not a claim. `scorePredictionMetrics`
 * reports the honest MAE / within-±3 rate on whatever rows you pass in.
 */

export type ScoreFeatureRow = {
  matchKey: string;
  eventType?: "week" | "district" | "regional" | "championship" | "other";
  week?: number;
  redScore: number;
  blueScore: number;
  red: TeamScoreFeatures[];
  blue: TeamScoreFeatures[];
};

export type TeamScoreFeatures = {
  teamKey: string;
  autoEpa: number | null;
  teleopEpa: number | null;
  endgameEpa: number | null;
  recentFormDelta?: number | null;
  opr?: number | null;
  dpr?: number | null;
  ccwm?: number | null;
  scoutCycles?: number | null;
  climbRate?: number | null;
  defenseFlag?: boolean;
};

export type AllianceScorePrediction = {
  matchKey: string;
  redPredicted: number;
  bluePredicted: number;
  /** Expected absolute error from the last backtest of this model version, if known. */
  errorBand: number;
  drivers: string[];
  modelVersion: "calibrated-linear-v1";
};

export type ScorePredictionSkip = {
  matchKey: string;
  skipReason: string;
};

export type ScorePredictionMetrics = {
  n: number;
  mae: number;
  rmse: number;
  within3: number;
  within5: number;
  byEventType: Record<string, { n: number; mae: number; within3: number }>;
  modelVersion: "calibrated-linear-v1";
};

const MODEL_VERSION = "calibrated-linear-v1" as const;

/**
 * Turn a measured MAE into the UI ±band. Round to the nearest point and never
 * claim a tighter interval than 1 — a zero band would look like a guarantee.
 */
export function errorBandFromMae(mae: number): number {
  if (!Number.isFinite(mae) || mae < 0) return 1;
  return Math.max(1, Math.round(mae));
}

/**
 * Rounded MAE of `fixtureSeasonRows()` (89.7 → 90). Tests lock this to
 * `scorePredictionMetrics` so the widget cannot silently drift back to a
 * placeholder. Not a season claim — the fixture scores are toy totals vs EPA.
 */
export const FIXTURE_ERROR_BAND = 90;

/** @deprecated Use FIXTURE_ERROR_BAND. Alias kept so older imports still resolve. */
export const DEFAULT_ERROR_BAND = FIXTURE_ERROR_BAND;

export function typicalScoreErrorCopy(errorBand: number): string {
  return `typical error ±${Math.round(errorBand)} (last measured set)`;
}

function resolveErrorBand(override: number | undefined): number {
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return Math.round(override);
  }
  return FIXTURE_ERROR_BAND;
}

function allianceTotal(side: TeamScoreFeatures[]): { total: number | null; missing: string[] } {
  const missing: string[] = [];
  let total = 0;
  let counted = 0;
  for (const team of side) {
    const auto = team.autoEpa;
    const teleop = team.teleopEpa;
    const endgame = team.endgameEpa;
    if (auto == null && teleop == null && endgame == null && team.opr == null) {
      missing.push(`${team.teamKey} has no EPA or OPR`);
      continue;
    }
    const epa = (auto ?? 0) + (teleop ?? 0) + (endgame ?? 0);
    const oprBlend = team.opr == null ? epa : 0.65 * epa + 0.35 * team.opr;
    const form = team.recentFormDelta ?? 0;
    const scout = team.scoutCycles == null ? 0 : Math.min(12, Math.max(-8, team.scoutCycles - 8)) * 0.35;
    const climb = team.climbRate == null ? 0 : (team.climbRate - 0.5) * 8;
    const defense = team.defenseFlag ? -2.5 : 0;
    total += oprBlend + form + scout + climb + defense;
    counted += 1;
  }
  if (counted < 2) {
    missing.push("Alliance is missing EPA/OPR for at least two robots");
    return { total: null, missing };
  }
  return { total, missing };
}

function driversFor(side: TeamScoreFeatures[], color: "red" | "blue"): string[] {
  const lines: string[] = [];
  const autos = side
    .map((team) => ({ team: team.teamKey.replace(/^frc/, ""), auto: team.autoEpa }))
    .filter((row) => row.auto != null)
    .sort((a, b) => (b.auto ?? 0) - (a.auto ?? 0));
  if (autos[0] && (autos[0].auto ?? 0) > 0) {
    lines.push(`${autos[0].team}'s auto is ${(autos[0].auto ?? 0).toFixed(1)} points on ${color}`);
  }
  const climbs = side.filter((team) => team.climbRate != null && team.climbRate >= 0.8);
  for (const team of climbs.slice(0, 1)) {
    lines.push(`${team.teamKey.replace(/^frc/, "")} climbs ${(team.climbRate! * 100).toFixed(0)}% of the time`);
  }
  const defense = side.find((team) => team.defenseFlag);
  if (defense) {
    lines.push(`${defense.teamKey.replace(/^frc/, "")} is marked for defense — a few points off the other alliance`);
  }
  return lines.slice(0, 3);
}

export function predictAllianceScores(
  row: Omit<ScoreFeatureRow, "redScore" | "blueScore"> & { redScore?: number; blueScore?: number },
  options?: { errorBand?: number },
): AllianceScorePrediction | ScorePredictionSkip {
  const red = allianceTotal(row.red);
  const blue = allianceTotal(row.blue);
  if (red.total == null || blue.total == null) {
    return {
      matchKey: row.matchKey,
      skipReason: [...red.missing, ...blue.missing].slice(0, 3).join("; ") || "Not enough team metrics to predict this match.",
    };
  }
  const redDrivers = driversFor(row.red, "red");
  const blueDrivers = driversFor(row.blue, "blue");
  return {
    matchKey: row.matchKey,
    redPredicted: Math.round(red.total * 10) / 10,
    bluePredicted: Math.round(blue.total * 10) / 10,
    errorBand: resolveErrorBand(options?.errorBand),
    drivers: [...redDrivers, ...blueDrivers].slice(0, 3),
    modelVersion: MODEL_VERSION,
  };
}

export function isScorePredictionSkip(
  value: AllianceScorePrediction | ScorePredictionSkip,
): value is ScorePredictionSkip {
  return "skipReason" in value;
}

function absErr(predicted: number, actual: number): number {
  return Math.abs(predicted - actual);
}

export function scorePredictionMetrics(rows: ScoreFeatureRow[]): ScorePredictionMetrics {
  const byEventType: ScorePredictionMetrics["byEventType"] = {};
  const errors: number[] = [];
  let within3 = 0;
  let within5 = 0;
  for (const row of rows) {
    const prediction = predictAllianceScores(row);
    if (isScorePredictionSkip(prediction)) continue;
    const redErr = absErr(prediction.redPredicted, row.redScore);
    const blueErr = absErr(prediction.bluePredicted, row.blueScore);
    errors.push(redErr, blueErr);
    if (redErr <= 3) within3 += 1;
    if (blueErr <= 3) within3 += 1;
    if (redErr <= 5) within5 += 1;
    if (blueErr <= 5) within5 += 1;
    const kind = row.eventType ?? "other";
    const bucket = byEventType[kind] ?? { n: 0, mae: 0, within3: 0 };
    bucket.n += 2;
    bucket.mae += redErr + blueErr;
    bucket.within3 += (redErr <= 3 ? 1 : 0) + (blueErr <= 3 ? 1 : 0);
    byEventType[kind] = bucket;
  }
  const n = errors.length;
  const mae = n ? errors.reduce((sum, value) => sum + value, 0) / n : 0;
  const rmse = n ? Math.sqrt(errors.reduce((sum, value) => sum + value * value, 0) / n) : 0;
  for (const bucket of Object.values(byEventType)) {
    bucket.mae = bucket.n ? bucket.mae / bucket.n : 0;
    bucket.within3 = bucket.n ? bucket.within3 / bucket.n : 0;
  }
  return {
    n,
    mae: Math.round(mae * 100) / 100,
    rmse: Math.round(rmse * 100) / 100,
    within3: n ? Math.round((within3 / n) * 1000) / 1000 : 0,
    within5: n ? Math.round((within5 / n) * 1000) / 1000 : 0,
    byEventType,
    modelVersion: MODEL_VERSION,
  };
}

/** Tiny fixture used when the reference tables are empty — not a season claim. */
export function fixtureSeasonRows(): ScoreFeatureRow[] {
  const team = (
    key: string,
    auto: number,
    tele: number,
    end: number,
    extra: Partial<TeamScoreFeatures> = {},
  ): TeamScoreFeatures => ({
    teamKey: key,
    autoEpa: auto,
    teleopEpa: tele,
    endgameEpa: end,
    ...extra,
  });
  return [
    {
      matchKey: "2025test_qm1",
      eventType: "week",
      week: 1,
      redScore: 94,
      blueScore: 81,
      red: [team("frc254", 18, 42, 12, { climbRate: 0.91 }), team("frc1678", 14, 38, 10), team("frc971", 11, 30, 8)],
      blue: [team("frc1323", 16, 36, 10), team("frc2056", 12, 34, 9), team("frc1114", 10, 28, 7)],
    },
    {
      matchKey: "2025test_qm2",
      eventType: "championship",
      week: 8,
      redScore: 110,
      blueScore: 102,
      red: [team("frc254", 20, 48, 14, { climbRate: 0.94 }), team("frc1678", 16, 40, 12), team("frc4414", 12, 32, 9)],
      blue: [team("frc1323", 18, 44, 12), team("frc2056", 15, 38, 11), team("frc3538", 12, 33, 8)],
    },
  ];
}
