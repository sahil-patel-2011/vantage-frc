/**
 * Fitting and grading the win curve.
 *
 * The engine turns a rating margin into a probability with
 * `p = 1 / (1 + exp(-margin / scale))`, and that scale was the number 12,
 * written once and never checked against a single real result. Twelve is a
 * guess about how much a point of rating margin is worth, and it is the guess
 * every probability in the product rests on. Too small and the model swears
 * blind that a coin flip is a certainty; too large and it refuses to commit to
 * a match that is already decided.
 *
 * This module fits that scale to matches that actually happened, and grades the
 * result. Both halves matter: a fitted number nobody measures is just a
 * different guess. `calibrationReport` is what says whether the fit made the
 * predictions better or only more confident, which are not the same thing and
 * are routinely confused.
 *
 * Every function here is pure and deterministic. Nothing reads the clock, so a
 * fit is reproducible from its inputs forever.
 */

/** The scale the engine used before anything was fitted. Kept as the fallback. */
export const DEFAULT_LOGISTIC_SCALE = 12;

/**
 * Below this many matches a fit is noise wearing a decimal point.
 *
 * Forty is not arbitrary: a single event's qualification schedule is roughly
 * this, and a season's first weekend is the earliest anyone should be told the
 * curve has been re-measured.
 */
export const MIN_FIT_SAMPLE = 40;

/** Bounds on the search. Outside these the curve is not a win curve any more. */
export const MIN_SCALE = 1;
export const MAX_SCALE = 200;

const clampProbability = (p: number) => Math.min(1 - 1e-9, Math.max(1e-9, p));

export function winProbabilityAt(margin: number, scale: number): number {
  return clampProbability(1 / (1 + Math.exp(-margin / scale)));
}

export type Outcome = {
  /** Our rating minus theirs, in rating points. */
  margin: number;
  /** Did the alliance the margin refers to actually win. */
  won: boolean;
};

/**
 * Mean negative log likelihood: the cost of being both wrong and sure.
 *
 * Log loss rather than Brier because it punishes confident errors far harder,
 * and a confident error is exactly what costs an alliance selection.
 */
export function logLoss(outcomes: readonly Outcome[], scale: number): number {
  if (!outcomes.length) return Number.NaN;
  let total = 0;
  for (const outcome of outcomes) {
    const p = winProbabilityAt(outcome.margin, scale);
    total -= outcome.won ? Math.log(p) : Math.log(1 - p);
  }
  return total / outcomes.length;
}

export function brierScore(outcomes: readonly Outcome[], scale: number): number {
  if (!outcomes.length) return Number.NaN;
  let total = 0;
  for (const outcome of outcomes) {
    const p = winProbabilityAt(outcome.margin, scale);
    total += (p - (outcome.won ? 1 : 0)) ** 2;
  }
  return total / outcomes.length;
}

export type ScaleFit = {
  scale: number;
  /** False when the sample was too thin or too one-sided to learn anything. */
  fitted: boolean;
  /** Why, in words, when it was not fitted. */
  reason: string | null;
  sample: number;
  /** Mean log loss at the chosen scale. */
  logLoss: number;
  /** Mean log loss the old fixed scale would have had on the same matches. */
  baselineLogLoss: number;
};

/**
 * The scale that best explains these results, by maximum likelihood.
 *
 * Golden-section search over log(scale). The search is on the log because the
 * difference between a scale of 2 and 4 matters enormously and the difference
 * between 150 and 152 does not, and searching linearly spends all its effort in
 * the range where nothing happens. It needs no derivatives and no starting
 * guess, and it cannot wander off the way gradient descent can on a flat tail.
 *
 * Refuses to fit rather than fitting badly. A sample with no losses in it has
 * its likelihood maximised by an arbitrarily small scale — the model would
 * learn "everything is certain", which is true of the sample and false of the
 * world.
 */
export function fitLogisticScale(outcomes: readonly Outcome[]): ScaleFit {
  const usable = outcomes.filter(
    (outcome) => Number.isFinite(outcome.margin) && typeof outcome.won === "boolean",
  );
  const baselineLogLoss = usable.length ? logLoss(usable, DEFAULT_LOGISTIC_SCALE) : Number.NaN;
  const bail = (reason: string): ScaleFit => ({
    scale: DEFAULT_LOGISTIC_SCALE,
    fitted: false,
    reason,
    sample: usable.length,
    logLoss: baselineLogLoss,
    baselineLogLoss,
  });

  if (usable.length < MIN_FIT_SAMPLE) {
    return bail(`Needs at least ${MIN_FIT_SAMPLE} finished matches; has ${usable.length}.`);
  }

  const wins = usable.filter((outcome) => outcome.won).length;
  if (wins === 0 || wins === usable.length) {
    return bail("Every match went the same way, so there is nothing to learn from.");
  }

  // A sample where the favourite always won, or always lost, pins the curve
  // against a bound. Both are real data and neither is a curve.
  const separable = usable.every(
    (outcome) => outcome.margin === 0 || outcome.won === outcome.margin > 0,
  );
  if (separable) {
    return bail("The rating margin called every single match, which no real sample does.");
  }

  const phi = (Math.sqrt(5) - 1) / 2;
  let low = Math.log(MIN_SCALE);
  let high = Math.log(MAX_SCALE);
  let c = high - phi * (high - low);
  let d = low + phi * (high - low);
  let fc = logLoss(usable, Math.exp(c));
  let fd = logLoss(usable, Math.exp(d));

  // ~60 iterations narrows the bracket far below any meaningful precision, and
  // a fixed count keeps the function total: no convergence failure to report.
  for (let i = 0; i < 60; i += 1) {
    if (fc < fd) {
      high = d;
      d = c;
      fd = fc;
      c = high - phi * (high - low);
      fc = logLoss(usable, Math.exp(c));
    } else {
      low = c;
      c = d;
      fc = fd;
      d = low + phi * (high - low);
      fd = logLoss(usable, Math.exp(d));
    }
  }

  const scale = Math.exp((low + high) / 2);
  const fittedLoss = logLoss(usable, scale);

  // A fit that is worse than the number it replaces is not a fit. This can
  // happen when the search lands on a bound, and shipping it would make every
  // prediction in the product worse in the name of having measured something.
  if (!(fittedLoss <= baselineLogLoss)) {
    return bail("The fitted curve explained these matches no better than the old one.");
  }

  return {
    scale: Math.round(scale * 100) / 100,
    fitted: true,
    reason: null,
    sample: usable.length,
    logLoss: Math.round(fittedLoss * 10_000) / 10_000,
    baselineLogLoss: Math.round(baselineLogLoss * 10_000) / 10_000,
  };
}

export type ReliabilityBucket = {
  /** "70–80%" — the confidence band this row covers. */
  label: string;
  low: number;
  high: number;
  n: number;
  /** Mean predicted probability in the bucket. */
  predicted: number;
  /** Share that actually won. */
  actual: number;
};

/**
 * Predicted versus actual, in bands.
 *
 * This is the plot that catches a model lying. If the matches it called at 80%
 * only came in 60% of the time, the model is overconfident, and no headline
 * accuracy number will show that — it can be right more often than not and
 * still be systematically overselling itself.
 *
 * Empty buckets are dropped: a band with no matches in it is not evidence of
 * anything and drawing it at zero reads as a catastrophic miss.
 */
export function reliabilityBuckets(
  outcomes: readonly Outcome[],
  scale: number,
  bucketCount = 5,
): ReliabilityBucket[] {
  const buckets = Math.max(2, Math.min(20, Math.trunc(bucketCount)));
  const rows: Array<{ n: number; predicted: number; actual: number }> = Array.from(
    { length: buckets },
    () => ({ n: 0, predicted: 0, actual: 0 }),
  );

  for (const outcome of outcomes) {
    const p = winProbabilityAt(outcome.margin, scale);
    const index = Math.min(buckets - 1, Math.floor(p * buckets));
    const row = rows[index]!;
    row.n += 1;
    row.predicted += p;
    row.actual += outcome.won ? 1 : 0;
  }

  const out: ReliabilityBucket[] = [];
  for (let i = 0; i < buckets; i += 1) {
    const row = rows[i]!;
    if (!row.n) continue;
    const low = i / buckets;
    const high = (i + 1) / buckets;
    out.push({
      label: `${Math.round(low * 100)}–${Math.round(high * 100)}%`,
      low,
      high,
      n: row.n,
      predicted: Math.round((row.predicted / row.n) * 1000) / 1000,
      actual: Math.round((row.actual / row.n) * 1000) / 1000,
    });
  }
  return out;
}

export type CalibrationReport = {
  sample: number;
  /** Share of matches whose winner the model named. */
  accuracy: number;
  brier: number;
  logLoss: number;
  /**
   * Expected calibration error: how far predicted sits from actual on average,
   * weighted by how many matches fall in each band. Zero is perfect.
   */
  expectedCalibrationError: number;
  /**
   * Positive when the model is surer than it earns, negative when it is too shy.
   * This is the number that decides whether anyone should trust a 90%.
   */
  overconfidence: number;
  buckets: ReliabilityBucket[];
  /** One sentence a person can act on. */
  verdict: string;
};

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Grade a set of predictions. Honest about small samples rather than quiet.
 */
export function calibrationReport(
  outcomes: readonly Outcome[],
  scale: number,
  bucketCount = 5,
): CalibrationReport | null {
  if (!outcomes.length) return null;

  let correct = 0;
  for (const outcome of outcomes) {
    const p = winProbabilityAt(outcome.margin, scale);
    if (p >= 0.5 === outcome.won) correct += 1;
  }

  const buckets = reliabilityBuckets(outcomes, scale, bucketCount);
  const ece =
    buckets.reduce(
      (sum, bucket) => sum + bucket.n * Math.abs(bucket.predicted - bucket.actual),
      0,
    ) / outcomes.length;

  // Confidence the model claimed, minus the share it actually got right.
  const claimed =
    outcomes.reduce((sum, outcome) => {
      const p = winProbabilityAt(outcome.margin, scale);
      return sum + Math.max(p, 1 - p);
    }, 0) / outcomes.length;
  const achieved = correct / outcomes.length;
  const overconfidence = claimed - achieved;

  const thin = outcomes.length < MIN_FIT_SAMPLE;
  const verdict = thin
    ? `Only ${outcomes.length} matches graded — too few to judge the model by.`
    : overconfidence > 0.08
      ? "Surer of itself than it earns. Treat a high percentage as a lean, not a lock."
      : overconfidence < -0.08
        ? "Too cautious. It is right more often than its own numbers claim."
        : "Honest: when it says seventy percent, it is right about seventy percent of the time.";

  return {
    sample: outcomes.length,
    accuracy: round3(achieved),
    brier: round3(brierScore(outcomes, scale)),
    logLoss: round3(logLoss(outcomes, scale)),
    expectedCalibrationError: round3(ece),
    overconfidence: round3(overconfidence),
    buckets,
    verdict,
  };
}
