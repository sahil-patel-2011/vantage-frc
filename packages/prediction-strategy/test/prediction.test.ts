import { describe, expect, it } from "vitest";
import {
  buildStrategyPlaybook,
  predictionAccuracy,
  predictMatch,
  runWhatIf,
  seasonWeight,
} from "../src";

const prediction = predictMatch({
  matchKey: "2026test_qm1",
  currentYear: 2026,
  red: ["frc1", "frc2", "frc3"],
  blue: ["frc4", "frc5", "frc6"],
  seasons: [
    ...["frc1", "frc2", "frc3"].map((teamKey) => ({
      teamKey,
      year: 2026,
      matches: 10,
      epa: 20,
      autoEpa: 7,
    })),
    ...["frc4", "frc5", "frc6"].map((teamKey) => ({
      teamKey,
      year: 2026,
      matches: 10,
      epa: 12,
      autoEpa: 3,
    })),
  ],
  operations: [{ teamKey: "frc1", scoutSample: 8, reliability: 95, foulRate: 0.2 }],
});

describe("weighted prediction", () => {
  it("weights current data above the prior two seasons", () => {
    expect([seasonWeight(2026, 2026), seasonWeight(2026, 2025), seasonWeight(2026, 2024)]).toEqual([
      1, 0.55, 0.3,
    ]);
    expect(seasonWeight(2026, 2023)).toBe(0);
  });

  it("returns calibrated bounds, factors, and deterministic probabilities", () => {
    expect(prediction.pRed).toBeGreaterThan(0.5);
    expect(prediction.confidenceLow).toBeLessThan(prediction.pRed);
    expect(prediction.confidenceHigh).toBeGreaterThan(prediction.pRed);
    expect(prediction.keyFactors.map((factor) => factor.name)).toContain("weighted scoring");
  });
});

describe("prediction to strategy", () => {
  it("shows what-if assumptions without rewriting the baseline", () => {
    const scenario = runWhatIf(prediction, [
      { alliance: "blue", label: "successful endgame", pointDelta: 12 },
    ]);
    expect(scenario.pRed).toBeLessThan(prediction.pRed);
    expect(scenario.assumptions[0]?.label).toBe("successful endgame");
  });

  it("builds an actionable playbook and post-match debrief", () => {
    const playbook = buildStrategyPlaybook({
      prediction,
      ourAlliance: "red",
      opponentFoulRisk: "high",
    });
    expect(playbook.priorities.length).toBeGreaterThanOrEqual(3);
    expect(playbook.debriefPrompts).toHaveLength(3);
    expect(playbook.provenance.length).toBeGreaterThan(0);
  });

  it("tracks classification and probability accuracy", () => {
    expect(
      predictionAccuracy([
        { pRed: 0.8, winner: "red" },
        { pRed: 0.4, winner: "blue" },
      ]),
    ).toEqual({ count: 2, accuracy: 1, brierScore: 0.1 });
  });
});
