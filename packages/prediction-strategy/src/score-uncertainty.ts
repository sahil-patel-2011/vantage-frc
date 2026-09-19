/**
 * How sure the score prediction is, per match, instead of once for the model.
 *
 * `calibrated-score.ts` predicts a number and reports `errorBand` — a single
 * constant from the last backtest, widened a little by whether the inputs were
 * official or scouted. So a match between four robots with forty matches of
 * history each and a match between three robots somebody watched twice this
 * morning come back with the same ±4, and a pick-list meeting has no way to
 * tell which number to lean on. The point estimate was never the weak part.
 *
 * This turns each robot into a small belief — a mean and a variance — and
 * propagates those to the alliance, the margin, and a win probability. Nothing
 * here invents an input: a robot with no spread on record contributes a
 * documented fallback, and a robot with nothing at all makes the match
 * unpredictable rather than confidently average.
 *
 * ## Where the variance comes from
 *
 * 1. **The robot's own game-to-game swing.** A metronome and a boom-or-bust
 *    robot with the same average are not the same bet, and for predicting a
 *    *single* match this is the dominant term — not the error of the mean.
 * 2. **How little we have watched.** The mean itself is uncertain, by roughly
 *    `swing / sqrt(matches)`.
 * 3. **Whether it survives the match.** A robot that has been towed off twice
 *    is a mixture: most matches it plays, sometimes it contributes nothing.
 *    That mixture adds `d(1 − d)μ²` of variance — which is why an unreliable
 *    *strong* robot is so much riskier than an unreliable weak one, and why a
 *    flat points penalty cannot express it.
 * 4. **The model's own residual error**, added once at the alliance level.
 *    This is the ±band the backtest measures; the rest is the field.
 */

import type { Distribution } from "./distribution";

/** What the predictor believes about one robot's contribution to one match. */
export type TeamScoreBelief = {
  teamKey: string;
  /** Expected points this robot adds, already decided by the score model. */
  mean: number;
  /** Matches this estimate rests on. 0 means "nothing watched". */
  observations: number;
  /**
   * Robust per-match spread in points, or null when unknown.
   * Prefer `matchSdFromDistribution` so this is the same number the pick list
   * calls "streaky".
   */
  matchSd: number | null;
  /** Share of observed matches this robot was disabled. 0 when not known. */
  disabledRate?: number;
  /** True when `mean` came from a season rating rather than only scouting. */
  official: boolean;
};

export type TeamVarianceBreakdown = {
  teamKey: string;
  mean: number;
  /** Total variance for this robot in this match, in points². */
  variance: number;
  swing: number;
  estimation: number;
  reliability: number;
  /** Null when nothing was known and a fallback had to be used. */
  measuredSpread: boolean;
};

export type AllianceBelief = {
  mean: number;
  sd: number;
  teams: TeamVarianceBreakdown[];
};

export type MatchBelief = {
  red: AllianceBelief;
  blue: AllianceBelief;
  /** Red minus blue. */
  marginMean: number;
  marginSd: number;
  /** P(red wins), from the normal margin. Clamped away from certainty. */
  redWinProbability: number;
  /** Half-width of the ~68% interval on each alliance total, rounded up to 1. */
  redBand: number;
  blueBand: number;
};

/**
 * A robot with no spread on record is assumed to swing by this share of its
 * own output.
 *
 * 0.30 is the middle of the "steady"/"streaky" boundary in `distribution.ts`,
 * chosen so an unmeasured robot is treated as ordinary rather than as either
 * a metronome or a disaster. It is a stated assumption, not a measurement, and
 * `measuredSpread: false` marks every estimate that leaned on it.
 */
export const FALLBACK_DISPERSION = 0.3;

/** IQR to standard deviation for a normal sample. */
const IQR_TO_SD = 1.349;

/**
 * Robots on one alliance are not independent: they share field space, game
 * pieces and one strategy, and a defended alliance has all three robots down
 * together. Positive correlation widens an alliance total beyond the sum of
 * its parts.
 *
 * Small on purpose. The dominant coupling — three robots cannot all score at
 * once — is already taken out of the *mean* by `ALLIANCE_INTERACTION` in
 * `calibrated-score.ts`; double-counting it here would make every band
 * uselessly wide.
 */
export const ALLIANCE_CORRELATION = 0.15;

/** Below this many observations the mean is barely constrained at all. */
export const MIN_OBSERVATIONS_FOR_MEAN = 2;

/**
 * The residual the model cannot explain, as a standard deviation per alliance.
 * Callers pass the measured value from a backtest; this is the fallback when
 * nothing has been measured yet.
 */
export const DEFAULT_MODEL_SD = 4;

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/** The per-match spread a pick list already computed, as a standard deviation. */
export function matchSdFromDistribution(distribution: Distribution | null): number | null {
  if (!distribution) return null;
  if (distribution.iqr == null || !Number.isFinite(distribution.iqr)) return null;
  if (distribution.iqr <= 0) return 0;
  return distribution.iqr / IQR_TO_SD;
}

/**
 * One robot's contribution variance.
 *
 * Exported for the same reason the win curve is: anything explaining *why* a
 * match is uncertain has to do the arithmetic the number was drawn from.
 */
export function teamVariance(belief: TeamScoreBelief): TeamVarianceBreakdown {
  const mean = Number.isFinite(belief.mean) ? belief.mean : 0;
  const measured = belief.matchSd != null && Number.isFinite(belief.matchSd) && belief.matchSd >= 0;
  // A robot that scores nothing still has a floor of uncertainty — using
  // `FALLBACK_DISPERSION * 0` would claim a zero-scoring robot is a certainty.
  const assumedSd = Math.max(2, FALLBACK_DISPERSION * Math.abs(mean));
  const sd = measured ? belief.matchSd! : assumedSd;

  const swing = sd * sd;

  // Standard error of the mean. With nothing watched the mean is a guess, so
  // the estimation term is as large as the swing itself rather than infinite.
  const n = Math.max(0, Math.floor(belief.observations));
  const estimation = n >= MIN_OBSERVATIONS_FOR_MEAN ? swing / n : swing;

  // The disabled mixture: with probability d this robot contributes ~nothing.
  const d = clamp(belief.disabledRate ?? 0, 0, 1);
  const reliability = d * (1 - d) * mean * mean;

  return {
    teamKey: belief.teamKey,
    mean,
    variance: swing + estimation + reliability,
    swing,
    estimation,
    reliability,
    measuredSpread: measured,
  };
}

/**
 * Combine three robots into one alliance total.
 *
 * `mean` is passed in rather than summed here, because the score model applies
 * its own interaction discount when it builds the total and this module must
 * not apply a second one.
 */
export function allianceBelief(
  mean: number,
  beliefs: readonly TeamScoreBelief[],
  options: { modelSd?: number } = {},
): AllianceBelief {
  const teams = beliefs.map(teamVariance);
  const independent = teams.reduce((total, team) => total + team.variance, 0);

  // 2ρ Σ_{i<j} σi σj — the covariance the sum misses.
  let covariance = 0;
  for (let i = 0; i < teams.length; i += 1) {
    for (let j = i + 1; j < teams.length; j += 1) {
      covariance += 2 * ALLIANCE_CORRELATION * Math.sqrt(teams[i]!.variance * teams[j]!.variance);
    }
  }

  // `>= 0`, not `> 0`. Written as `> 0` this treated an explicit `modelSd: 0`
  // as "not supplied" and quietly substituted the default, so a caller asking
  // for the field variance alone got the model's error folded in anyway.
  const modelSd =
    options.modelSd != null && Number.isFinite(options.modelSd) && options.modelSd >= 0
      ? options.modelSd
      : DEFAULT_MODEL_SD;
  const variance = independent + covariance + modelSd * modelSd;
  return { mean, sd: Math.sqrt(Math.max(0, variance)), teams };
}

/**
 * Normal CDF, via Abramowitz & Stegun 7.1.26 (max error ~1.5e-7).
 *
 * Written out rather than pulled in: this file is the only thing in the
 * package that needs it, and a dependency for eleven lines of arithmetic is a
 * supply-chain decision, not a convenience.
 */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Never 0 or 1. A match between a rookie and a world champion is not a
 * certainty — robots break — and a screen saying 100% is wrong the first time
 * it is wrong.
 */
export const MIN_WIN_PROBABILITY = 0.02;
export const MAX_WIN_PROBABILITY = 0.98;

export function matchBelief(
  red: { mean: number; beliefs: readonly TeamScoreBelief[] },
  blue: { mean: number; beliefs: readonly TeamScoreBelief[] },
  options: { modelSd?: number } = {},
): MatchBelief {
  const redBelief = allianceBelief(red.mean, red.beliefs, options);
  const blueBelief = allianceBelief(blue.mean, blue.beliefs, options);

  const marginMean = redBelief.mean - blueBelief.mean;
  // Red and blue are treated as independent. They are not quite — a defensive
  // robot lowers one total while the other is unaffected — but the sign of
  // that coupling depends on who is playing defense, which the inputs here do
  // not say, and assuming a direction would be inventing one.
  const marginSd = Math.sqrt(redBelief.sd * redBelief.sd + blueBelief.sd * blueBelief.sd);

  const redWinProbability =
    marginSd > 0
      ? clamp(normalCdf(marginMean / marginSd), MIN_WIN_PROBABILITY, MAX_WIN_PROBABILITY)
      : marginMean > 0
        ? MAX_WIN_PROBABILITY
        : marginMean < 0
          ? MIN_WIN_PROBABILITY
          : 0.5;

  return {
    red: redBelief,
    blue: blueBelief,
    marginMean,
    marginSd,
    redWinProbability,
    redBand: Math.max(1, Math.round(redBelief.sd)),
    blueBand: Math.max(1, Math.round(blueBelief.sd)),
  };
}

/**
 * The single most useful sentence about a prediction: what would have to be
 * true for it to be wrong.
 */
export function describeConfidence(belief: MatchBelief): string {
  const favourite = belief.marginMean >= 0 ? "Red" : "Blue";
  const probability = belief.marginMean >= 0 ? belief.redWinProbability : 1 - belief.redWinProbability;
  const percent = Math.round(probability * 100);
  const margin = Math.abs(Math.round(belief.marginMean));

  const thin = [...belief.red.teams, ...belief.blue.teams].filter((team) => !team.measuredSpread);
  const unreliable = [...belief.red.teams, ...belief.blue.teams]
    .filter((team) => team.reliability > team.swing * 0.25)
    .map((team) => team.teamKey.replace(/^frc/i, ""));

  const parts = [`${favourite} by about ${margin}, ${percent}% likely`];
  if (unreliable.length) {
    parts.push(
      `${unreliable.join(", ")} ${unreliable.length === 1 ? "has" : "have"} been dying on the field, which is most of the doubt here`,
    );
  } else if (thin.length >= 3) {
    parts.push("wide because most of these robots have barely been watched");
  }
  return `${parts.join(" — ")}.`;
}
