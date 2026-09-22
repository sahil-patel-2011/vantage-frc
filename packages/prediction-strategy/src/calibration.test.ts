import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOGISTIC_SCALE,
  MIN_FIT_SAMPLE,
  brierScore,
  calibrationReport,
  fitLogisticScale,
  logLoss,
  reliabilityBuckets,
  winProbabilityAt,
  type Outcome,
} from "./calibration";

/**
 * A dataset whose true scale we know, built without randomness.
 *
 * For each margin we emit the number of wins the true curve implies out of a
 * fixed count. The maximum-likelihood estimate of such a sample is the scale
 * that generated it, so a fitter that works has to find its way back to it.
 */
function sampleAtScale(trueScale: number, perMargin = 24): Outcome[] {
  const out: Outcome[] = [];
  for (let margin = -30; margin <= 30; margin += 2) {
    const p = winProbabilityAt(margin, trueScale);
    const wins = Math.round(p * perMargin);
    for (let i = 0; i < perMargin; i += 1) {
      out.push({ margin, won: i < wins });
    }
  }
  return out;
}

describe("winProbabilityAt", () => {
  it("is a coin flip at no margin", () => {
    expect(winProbabilityAt(0, 12)).toBeCloseTo(0.5, 10);
  });

  it("rises with the margin and never reaches certainty", () => {
    expect(winProbabilityAt(10, 12)).toBeGreaterThan(winProbabilityAt(5, 12));
    expect(winProbabilityAt(10_000, 12)).toBeLessThan(1);
    expect(winProbabilityAt(-10_000, 12)).toBeGreaterThan(0);
  });

  it("a smaller scale means more confidence at the same margin", () => {
    expect(winProbabilityAt(8, 4)).toBeGreaterThan(winProbabilityAt(8, 20));
  });
});

describe("fitLogisticScale", () => {
  it("finds its way back to the scale that generated the data", () => {
    for (const trueScale of [6, 12, 25]) {
      const fit = fitLogisticScale(sampleAtScale(trueScale));
      expect(fit.fitted, `scale ${trueScale}`).toBe(true);
      // Within 12%: the sample is rounded to whole wins per margin, so an exact
      // recovery is not on offer and demanding one would be testing the fixture.
      expect(Math.abs(fit.scale - trueScale) / trueScale, `scale ${trueScale}`).toBeLessThan(0.12);
    }
  });

  it("beats the hardcoded twelve on data that was not generated at twelve", () => {
    // This is the whole point: the number in the code was a guess, and on a
    // season that does not behave like the guess it costs accuracy every match.
    const fit = fitLogisticScale(sampleAtScale(5));
    expect(fit.fitted).toBe(true);
    expect(fit.logLoss).toBeLessThan(fit.baselineLogLoss);
  });

  it("refuses a sample too thin to learn from", () => {
    const fit = fitLogisticScale(sampleAtScale(12).slice(0, MIN_FIT_SAMPLE - 1));
    expect(fit.fitted).toBe(false);
    expect(fit.scale).toBe(DEFAULT_LOGISTIC_SCALE);
    expect(fit.reason).toMatch(/at least/i);
  });

  it("refuses a sample where everybody won", () => {
    // The likelihood of this is maximised by an arbitrarily small scale, which
    // teaches the model that everything is certain.
    const outcomes: Outcome[] = Array.from({ length: 80 }, (_, i) => ({
      margin: i - 40,
      won: true,
    }));
    const fit = fitLogisticScale(outcomes);
    expect(fit.fitted).toBe(false);
    expect(fit.reason).toMatch(/same way/i);
  });

  it("refuses a sample the margin called perfectly", () => {
    // Real matches are not separable. A sample that is has something wrong with
    // it, and fitting to it pins the curve against a bound.
    const outcomes: Outcome[] = Array.from({ length: 80 }, (_, i) => {
      const margin = i - 40 + (i >= 40 ? 1 : 0);
      return { margin, won: margin > 0 };
    });
    const fit = fitLogisticScale(outcomes);
    expect(fit.fitted).toBe(false);
    expect(fit.reason).toMatch(/every single match/i);
  });

  it("keeps the old scale when there is nothing at all", () => {
    const fit = fitLogisticScale([]);
    expect(fit.scale).toBe(DEFAULT_LOGISTIC_SCALE);
    expect(fit.fitted).toBe(false);
    expect(fit.sample).toBe(0);
  });

  it("ignores rows with an unusable margin rather than poisoning the fit", () => {
    const outcomes = [
      ...sampleAtScale(10),
      { margin: Number.NaN, won: true },
      { margin: Number.POSITIVE_INFINITY, won: false },
    ];
    const fit = fitLogisticScale(outcomes);
    expect(fit.fitted).toBe(true);
    expect(fit.sample).toBe(sampleAtScale(10).length);
  });

  it("never returns a scale outside the bounds of a real win curve", () => {
    const fit = fitLogisticScale(sampleAtScale(12));
    expect(fit.scale).toBeGreaterThanOrEqual(1);
    expect(fit.scale).toBeLessThanOrEqual(200);
  });
});

describe("logLoss and brierScore", () => {
  it("punish a confident error harder than a hesitant one", () => {
    const confidentlyWrong: Outcome[] = [{ margin: -40, won: true }];
    const hesitantlyWrong: Outcome[] = [{ margin: -1, won: true }];
    expect(logLoss(confidentlyWrong, 12)).toBeGreaterThan(logLoss(hesitantlyWrong, 12));
    expect(brierScore(confidentlyWrong, 12)).toBeGreaterThan(brierScore(hesitantlyWrong, 12));
  });

  it("log loss punishes confident errors far harder than Brier does", () => {
    // Which is why the fit minimises log loss: an alliance selection made on a
    // confident wrong call is the expensive failure.
    const wrong: Outcome[] = [{ margin: -60, won: true }];
    expect(logLoss(wrong, 12)).toBeGreaterThan(4);
    expect(brierScore(wrong, 12)).toBeLessThan(1);
  });

  it("are NaN on nothing rather than a flattering zero", () => {
    expect(Number.isNaN(logLoss([], 12))).toBe(true);
    expect(Number.isNaN(brierScore([], 12))).toBe(true);
  });
});

describe("reliabilityBuckets", () => {
  it("drops empty bands instead of drawing them as total misses", () => {
    const buckets = reliabilityBuckets([{ margin: 0, won: true }], 12, 10);
    expect(buckets.length).toBe(1);
    expect(buckets[0]?.n).toBe(1);
  });

  it("counts every match exactly once", () => {
    const outcomes = sampleAtScale(12);
    const total = reliabilityBuckets(outcomes, 12, 5).reduce((sum, b) => sum + b.n, 0);
    expect(total).toBe(outcomes.length);
  });

  it("lines up predicted with actual on data that matches the curve", () => {
    for (const bucket of reliabilityBuckets(sampleAtScale(12), 12, 5)) {
      expect(Math.abs(bucket.predicted - bucket.actual), bucket.label).toBeLessThan(0.1);
    }
  });
});

describe("calibrationReport", () => {
  it("says nothing at all about nothing", () => {
    expect(calibrationReport([], 12)).toBeNull();
  });

  it("calls a well-matched model honest", () => {
    const report = calibrationReport(sampleAtScale(12), 12)!;
    expect(report.expectedCalibrationError).toBeLessThan(0.05);
    expect(Math.abs(report.overconfidence)).toBeLessThan(0.08);
    expect(report.verdict).toMatch(/honest/i);
  });

  it("catches a model that is surer than it earns", () => {
    // Data generated at a wide scale, graded with a narrow one: the model will
    // claim near-certainty on matches that were close to even.
    const report = calibrationReport(sampleAtScale(30), 3)!;
    expect(report.overconfidence).toBeGreaterThan(0.08);
    expect(report.verdict).toMatch(/surer of itself/i);
  });

  it("catches a model that is too shy to commit", () => {
    const report = calibrationReport(sampleAtScale(4), 60)!;
    expect(report.overconfidence).toBeLessThan(-0.08);
    expect(report.verdict).toMatch(/too cautious/i);
  });

  it("refuses to grade a model on a handful of matches", () => {
    const report = calibrationReport(sampleAtScale(12).slice(0, 10), 12)!;
    expect(report.verdict).toMatch(/too few/i);
  });

  it("reports accuracy separately from calibration, because they differ", () => {
    // A model can name the winner most of the time and still be badly
    // calibrated. Collapsing the two into one number hides exactly that.
    const report = calibrationReport(sampleAtScale(30), 3)!;
    expect(report.accuracy).toBeGreaterThan(0.5);
    expect(report.expectedCalibrationError).toBeGreaterThan(0.05);
  });
});
