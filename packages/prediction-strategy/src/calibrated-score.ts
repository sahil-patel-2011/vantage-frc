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


import {
  MIN_MATCHES_TO_STAND_ALONE,
  canStandAlone,
  type ScoutedTeamRating,
} from "./scouting-rating";
import {
  describeConfidence,
  matchBelief,
  type TeamScoreBelief,
} from "./score-uncertainty";

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
  /**
   * What this team's own scouts recorded about this robot, already converted
   * to points by the org's value formula.
   *
   * This is the only input that exists at an off-season event, a week-0
   * scrimmage, or the first morning of week 1, where Statbotics and the OPR
   * family have nothing yet. When there is no official rating it carries the
   * prediction on its own; when there is one it nudges it.
   */
  scouted?: ScoutedTeamRating | null;
  /**
   * This robot's match-to-match spread in points, when the caller has it —
   * `matchSdFromDistribution(summariseDistribution(series))`.
   *
   * Optional because most callers do not have per-match rows to hand. Without
   * it the uncertainty model falls back to a stated assumption and marks the
   * estimate as unmeasured; with it, a metronome and a boom-or-bust robot with
   * the same average stop producing the same confidence.
   */
  matchSd?: number | null;
};

export type AllianceScorePrediction = {
  matchKey: string;
  redPredicted: number;
  bluePredicted: number;
  /** Expected absolute error from the last backtest of this model version, if known. */
  errorBand: number;
  drivers: string[];
  modelVersion: "calibrated-linear-v2";
  /**
   * Where the number came from, so the screen can say so.
   *
   * `"official"` — every robot had a Statbotics or OPR-family rating.
   * `"scouting"` — none did, and the estimate is built entirely from what this
   *   team watched. This is the normal case at an off-season event.
   * `"mixed"`   — some of each.
   */
  basis: ScorePredictionBasis;
  /**
   * Per-match confidence, as opposed to `errorBand`, which is how well the
   * model does on average.
   *
   * These move with the robots actually on the field: how much each one
   * swings, how many matches it rests on, and whether it has been breaking
   * down. Two matches with the same predicted scores can have very different
   * numbers here, and that difference is the point.
   */
  redBand: number;
  blueBand: number;
  /** P(red wins), never 0 or 1 — robots break. */
  redWinProbability: number;
  /** One line naming the favourite and where the doubt is coming from. */
  confidence: string;
};

export type ScorePredictionBasis = "official" | "scouting" | "mixed";

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
  modelVersion: "calibrated-linear-v2";
};

const MODEL_VERSION = "calibrated-linear-v2" as const;

/** Three robots share field space and game pieces — do not sum three full ratings. */
const ALLIANCE_INTERACTION = 0.5;
const SCOUT_SHRINK = 0.65;
const OPPONENT_DPR_WEIGHT = 0.12;

/**
 * Turn a measured MAE into the UI ±band. Round to the nearest point and never
 * claim a tighter interval than 1 — a zero band would look like a guarantee.
 */
export function errorBandFromMae(mae: number): number {
  if (!Number.isFinite(mae) || mae < 0) return 1;
  return Math.max(1, Math.round(mae));
}

/**
 * Rounded MAE of `fixtureSeasonRows()` after v2. Tests lock this to
 * `scorePredictionMetrics` so the widget cannot silently drift back to a
 * placeholder. Not a season claim — the fixture scores are toy totals vs ratings.
 */
export const FIXTURE_ERROR_BAND = 4;

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

function tanh(value: number): number {
  const exp = Math.exp(2 * value);
  return (exp - 1) / (exp + 1);
}

/**
 * How much a scouting-only rating is trusted as a stand-in for EPA.
 *
 * Not 1.0. A scouting mean is one team's view of a robot, from one vantage
 * point, without the cross-checking a field-wide model gets — and the points
 * come from the org's own formula, which may weight the game differently from
 * the official breakdown. Discounting it slightly keeps a scouting-only
 * prediction from reading as confidently as one built on a season of results.
 */
const SCOUTED_AS_RATING = 0.9;

function teamContribution(team: TeamScoreFeatures): number | null {
  const auto = team.autoEpa;
  const teleop = team.teleopEpa;
  const endgame = team.endgameEpa;
  const hasOfficial =
    auto != null || teleop != null || endgame != null || team.opr != null || team.ccwm != null;

  if (!hasOfficial) {
    // Nothing official exists for this robot. If the team watched it enough
    // times, that is a real rating and the match is predictable after all —
    // this is the whole point at an off-season event.
    if (!canStandAlone(team.scouted)) return null;
    const scouted = team.scouted!;
    const climb = scouted.climbRate == null ? 0 : (scouted.climbRate - 0.5) * 6;
    const defense = scouted.defenseRate >= 0.5 ? -2 : 0;
    return scouted.shrunkTotal * SCOUTED_AS_RATING + climb + defense;
  }

  const epa = (auto ?? 0) + (teleop ?? 0) + (endgame ?? 0);
  let rating = epa;
  if (team.opr != null && team.ccwm != null) {
    rating = 0.52 * epa + 0.28 * team.opr + 0.2 * team.ccwm;
  } else if (team.opr != null) {
    rating = 0.62 * epa + 0.38 * team.opr;
  } else if (team.ccwm != null) {
    rating = 0.75 * epa + 0.25 * team.ccwm;
  }
  const form = tanh((team.recentFormDelta ?? 0) / 12) * 8;
  const scoutRaw =
    team.scoutCycles == null ? 0 : Math.min(12, Math.max(-8, team.scoutCycles - 8)) * 0.35;
  const climb = (team.climbRate ?? team.scouted?.climbRate) == null
    ? 0
    : ((team.climbRate ?? team.scouted!.climbRate!) - 0.5) * 6;
  const defense = team.defenseFlag || (team.scouted?.defenseRate ?? 0) >= 0.5 ? -2 : 0;
  return rating + form + scoutRaw * SCOUT_SHRINK + climb + defense + reliabilityAdjustment(team, rating);
}

/**
 * A robot that dies contributes nothing that match, and the official rating
 * does not know it.
 *
 * EPA is built from final scores, so a breakdown shows up only as a bad match
 * mixed in with good ones. The scouts watching know the difference between a
 * robot having an off match and a robot that has been towed off the field
 * twice today, and that difference is worth points in expectation.
 *
 * Scaled against the team's own rating rather than a flat penalty: losing a
 * 60-point robot for a third of its matches costs far more than losing a
 * 10-point one, and the adjustment is capped so a small sample of bad luck
 * cannot erase a team.
 */
function reliabilityAdjustment(team: TeamScoreFeatures, rating: number): number {
  const scouted = team.scouted;
  if (!scouted || scouted.matches < MIN_MATCHES_TO_STAND_ALONE) return 0;
  if (scouted.disabledRate <= 0) return 0;
  return -Math.min(0.3, scouted.disabledRate) * Math.max(0, rating);
}

/**
 * Why this robot has no number, in a form somebody can act on.
 *
 * "has no rating yet" is true and useless. At an off-season event nothing
 * official is ever coming, so the only thing that can change the answer is
 * scouting another match — and the message should say that, and say how close
 * the team already is.
 */
function missingReason(team: TeamScoreFeatures): string {
  const number = team.teamKey.replace(/^frc/, "");
  const scouted = team.scouted;
  if (scouted && scouted.matches > 0) {
    const need = MIN_MATCHES_TO_STAND_ALONE - scouted.matches;
    const plural = need === 1 ? "match" : "matches";
    return `${number} has no official rating — scout ${need} more ${plural} and we can estimate it`;
  }
  return `${number} has no official rating and nobody has scouted it yet`;
}

function allianceTotal(
  side: TeamScoreFeatures[],
  opponent: TeamScoreFeatures[] = [],
): { total: number | null; missing: string[] } {
  const missing: string[] = [];
  let total = 0;
  let counted = 0;
  for (const team of side) {
    const contribution = teamContribution(team);
    if (contribution == null) {
      missing.push(missingReason(team));
      continue;
    }
    total += contribution;
    counted += 1;
  }
  if (counted < 2) {
    missing.push("This alliance is missing ratings for at least two robots");
    return { total: null, missing };
  }
  const dprPressure = opponent.reduce((sum, team) => sum + (team.dpr ?? 0), 0) * OPPONENT_DPR_WEIGHT;
  return { total: total * ALLIANCE_INTERACTION - dprPressure, missing };
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

/**
 * How many matches an official rating is treated as resting on.
 *
 * EPA and the OPR family are built from a season of results, so the *mean* is
 * far better constrained than any scouting sample — but the number of matches
 * behind it is not in the feature row. Twelve is a qualification schedule: it
 * makes an official rating clearly firmer than three scouted matches without
 * pretending it is exact. A stated assumption, like the rest of them.
 */
const OFFICIAL_OBSERVATIONS = 12;

/** One robot, in the shape the uncertainty model reasons about. */
function beliefFor(team: TeamScoreFeatures, mean: number): TeamScoreBelief {
  const scouted = team.scouted ?? null;
  const official = hasOfficialRating(team);
  const scoutedMatches = scouted?.matches ?? 0;
  return {
    teamKey: team.teamKey,
    mean,
    observations: official ? Math.max(OFFICIAL_OBSERVATIONS, scoutedMatches) : scoutedMatches,
    matchSd: team.matchSd ?? null,
    disabledRate: scouted?.disabledRate ?? 0,
    official,
  };
}

export function predictAllianceScores(
  row: Omit<ScoreFeatureRow, "redScore" | "blueScore"> & { redScore?: number; blueScore?: number },
  options?: { errorBand?: number },
): AllianceScorePrediction | ScorePredictionSkip {
  const red = allianceTotal(row.red, row.blue);
  const blue = allianceTotal(row.blue, row.red);
  if (red.total == null || blue.total == null) {
    return {
      matchKey: row.matchKey,
      skipReason: [...red.missing, ...blue.missing].slice(0, 3).join("; ") || "Not enough team metrics to predict this match.",
    };
  }
  const redDrivers = driversFor(row.red, "red");
  const blueDrivers = driversFor(row.blue, "blue");
  const basis = basisFor([...row.red, ...row.blue]);
  const drivers = [...redDrivers, ...blueDrivers].slice(0, 3);
  if (basis === "scouting") {
    // Say it on the card, not just in a field the UI might ignore.
    drivers.unshift("Estimated from your scouting — no official numbers exist for this event yet");
  }
  // `errorBand` keeps its meaning — how well this model does on average, and
  // what an explicit override sets. The per-match numbers below are a
  // different question and get their own fields rather than redefining it.
  const modelBand = widenForBasis(resolveErrorBand(options?.errorBand), basis);
  const belief = matchBelief(
    { mean: red.total, beliefs: beliefsFor(row.red) },
    { mean: blue.total, beliefs: beliefsFor(row.blue) },
    { modelSd: modelBand },
  );

  return {
    matchKey: row.matchKey,
    redPredicted: Math.round(red.total * 10) / 10,
    bluePredicted: Math.round(blue.total * 10) / 10,
    errorBand: modelBand,
    drivers: drivers.slice(0, 3),
    modelVersion: MODEL_VERSION,
    basis,
    redBand: belief.redBand,
    blueBand: belief.blueBand,
    redWinProbability: Math.round(belief.redWinProbability * 1000) / 1000,
    confidence: describeConfidence(belief),
  };
}

/** Only robots that actually have a number carry uncertainty. */
function beliefsFor(side: readonly TeamScoreFeatures[]): TeamScoreBelief[] {
  const out: TeamScoreBelief[] = [];
  for (const team of side) {
    const contribution = teamContribution(team);
    if (contribution == null) continue;
    out.push(beliefFor(team, contribution));
  }
  return out;
}

function hasOfficialRating(team: TeamScoreFeatures): boolean {
  return (
    team.autoEpa != null ||
    team.teleopEpa != null ||
    team.endgameEpa != null ||
    team.opr != null ||
    team.ccwm != null
  );
}

function basisFor(teams: readonly TeamScoreFeatures[]): ScorePredictionBasis {
  const rated = teams.filter((team) => teamContribution(team) != null);
  if (rated.length === 0) return "official";
  const official = rated.filter(hasOfficialRating).length;
  if (official === rated.length) return "official";
  if (official === 0) return "scouting";
  return "mixed";
}

/**
 * A number built from one team's scouting deserves a wider band than one built
 * from a season of results, and saying so is the difference between a useful
 * estimate and a claim the product cannot back.
 */
const SCOUTING_BAND_MULTIPLIER = 1.6;
const MIXED_BAND_MULTIPLIER = 1.25;

function widenForBasis(band: number, basis: ScorePredictionBasis): number {
  if (basis === "scouting") return Math.round(band * SCOUTING_BAND_MULTIPLIER);
  if (basis === "mixed") return Math.round(band * MIXED_BAND_MULTIPLIER);
  return band;
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
