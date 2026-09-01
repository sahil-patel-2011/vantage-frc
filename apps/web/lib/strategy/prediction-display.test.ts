import { describe, expect, it } from "vitest";
import {
  formatPredictionWinDisplay,
  isDemoPrediction,
  isUngroundedPrediction,
  predictionWinDisplay,
  predictionWinProbability,
  type PredictionDisplayInput,
} from "./prediction-display";

function grounded(overrides: Partial<PredictionDisplayInput> = {}): PredictionDisplayInput {
  return {
    winProbability: 0.62,
    modelVersion: "weighted-current-v1",
    grounded: true,
    ...overrides,
  };
}

describe("predictionWinDisplay", () => {
  it("formats a finite grounded win probability", () => {
    expect(predictionWinDisplay(grounded())).toEqual({
      probability: 0.62,
      percent: 62,
      label: "62%",
    });
    expect(formatPredictionWinDisplay(grounded())).toBe("62%");
    expect(predictionWinProbability(grounded())).toBe(0.62);
  });

  it("keeps 0% and 100% when they are real unit probabilities", () => {
    expect(formatPredictionWinDisplay(grounded({ winProbability: 0 }))).toBe("0%");
    expect(formatPredictionWinDisplay(grounded({ winProbability: 1 }))).toBe("100%");
  });

  it("derives the alliance probability from pRed / pBlue", () => {
    const sides = { pRed: 0.71, pBlue: 0.29, modelVersion: "strategy-engine-v2", grounded: true };
    expect(predictionWinProbability({ ...sides, alliance: "red" })).toBe(0.71);
    expect(formatPredictionWinDisplay({ ...sides, alliance: "blue" })).toBe("29%");
  });

  it("prefers winProbability over alliance sides", () => {
    expect(
      predictionWinProbability(
        grounded({ winProbability: 0.4, pRed: 0.9, pBlue: 0.1, alliance: "red" }),
      ),
    ).toBe(0.4);
  });

  it("returns null when the prediction is missing", () => {
    expect(predictionWinDisplay(null)).toBeNull();
    expect(predictionWinDisplay(undefined)).toBeNull();
    expect(predictionWinDisplay({})).toBeNull();
    expect(predictionWinDisplay({ alliance: "red", pBlue: 0.4 })).toBeNull();
    expect(formatPredictionWinDisplay({ winProbability: null, grounded: true })).toBeNull();
  });

  it("returns null for NaN and non-finite values — never a DEMO %", () => {
    expect(predictionWinDisplay(grounded({ winProbability: Number.NaN }))).toBeNull();
    expect(predictionWinDisplay(grounded({ winProbability: Number.POSITIVE_INFINITY }))).toBeNull();
    expect(predictionWinDisplay(grounded({ winProbability: Number.NEGATIVE_INFINITY }))).toBeNull();
    expect(predictionWinProbability(grounded({ pRed: Number.NaN, alliance: "red", winProbability: null }))).toBeNull();
  });

  it("returns null for values outside 0–1", () => {
    expect(formatPredictionWinDisplay(grounded({ winProbability: 1.5 }))).toBeNull();
    expect(formatPredictionWinDisplay(grounded({ winProbability: -0.01 }))).toBeNull();
    expect(formatPredictionWinDisplay(grounded({ winProbability: 62 }))).toBeNull();
  });

  it("refuses a DEMO model, source, or caveat even when numbers are present", () => {
    expect(predictionWinDisplay(grounded({ modelVersion: "DEMO" }))).toBeNull();
    expect(predictionWinDisplay(grounded({ modelVersion: "demo-v1" }))).toBeNull();
    expect(predictionWinDisplay(grounded({ source: "DEMO cache" }))).toBeNull();
    expect(predictionWinDisplay(grounded({ caveats: ["DEMO placeholder"] }))).toBeNull();
    expect(isDemoPrediction(grounded({ modelVersion: "DEMO" }))).toBe(true);
    expect(isDemoPrediction(grounded())).toBe(false);
  });

  it("refuses an ungrounded prediction even when numbers are present", () => {
    expect(predictionWinDisplay(grounded({ grounded: false }))).toBeNull();
    expect(predictionWinDisplay({ winProbability: 0.8, status: "ungrounded" })).toBeNull();
    expect(predictionWinDisplay({ winProbability: 0.8, modelVersion: "ungrounded-v1" })).toBeNull();
    expect(predictionWinDisplay({ winProbability: 0.8, caveats: ["ungrounded EPA"] })).toBeNull();
    expect(isUngroundedPrediction(grounded({ grounded: false }))).toBe(true);
    expect(isUngroundedPrediction(grounded())).toBe(false);
  });

  it("treats omitted grounded as displayable when the number is real and not DEMO", () => {
    expect(formatPredictionWinDisplay({ winProbability: 0.55, modelVersion: "strategy-engine-max-v1" })).toBe(
      "55%",
    );
    expect(isUngroundedPrediction({ winProbability: 0.55, modelVersion: "strategy-engine-max-v1" })).toBe(
      false,
    );
  });

  it("does not treat real engine ids as DEMO", () => {
    for (const modelVersion of ["weighted-current-v1", "strategy-engine-v2", "strategy-engine-max-v1"]) {
      expect(isDemoPrediction({ modelVersion, winProbability: 0.5 })).toBe(false);
      expect(formatPredictionWinDisplay({ modelVersion, winProbability: 0.5 })).toBe("50%");
    }
  });
});
