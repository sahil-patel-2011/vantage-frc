import { describe, expect, it } from "vitest";
import { evaluateRecordedPredictions, type MeasuredPrediction } from "./prediction-evaluation";
const row: MeasuredPrediction = { modelVersion: "v1", probability: .9, winner: "red", predictedAt: "2026-10-02T12:00:00Z", startedAt: "2026-10-02T13:00:00Z" };
describe("measured prediction performance", () => {
  it("never manufactures a claimed success rate without samples", () => expect(evaluateRecordedPredictions([])).toEqual([]));
  it("excludes hindsight, ties, invalid probabilities and incomplete timestamps", () => {
    const result = evaluateRecordedPredictions([row, { ...row, predictedAt: row.startedAt }, { ...row, winner: "" }, { ...row, probability: NaN }, { ...row, startedAt: "invalid" }]);
    expect(result[0]).toMatchObject({ matches: 1, accuracy: 1 });
  });
  it("penalizes confident mistakes and keeps model versions separate", () => {
    const result = evaluateRecordedPredictions([row, { ...row, winner: "blue" }, { ...row, modelVersion: "v2", probability: .99, winner: "blue" }]);
    expect(result[0]).toMatchObject({ modelVersion: "v1", matches: 2, accuracy: .5 });
    expect(result[1]!.logLoss).toBeGreaterThan(result[0]!.logLoss);
    expect(result[1]!.brier).toBeGreaterThan(result[0]!.brier);
  });
});
