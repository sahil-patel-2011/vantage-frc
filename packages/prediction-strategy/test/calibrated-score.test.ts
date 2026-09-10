import { describe, expect, it } from "vitest";
import {
  fixtureSeasonRows,
  isScorePredictionSkip,
  predictAllianceScores,
  scorePredictionMetrics,
} from "../src/calibrated-score";

describe("calibrated alliance score predictor", () => {
  it("returns a skip instead of a number when an alliance has no metrics", () => {
    const skipped = predictAllianceScores({
      matchKey: "2025test_qm9",
      red: [
        { teamKey: "frc1", autoEpa: null, teleopEpa: null, endgameEpa: null },
        { teamKey: "frc2", autoEpa: null, teleopEpa: null, endgameEpa: null },
        { teamKey: "frc3", autoEpa: null, teleopEpa: null, endgameEpa: null },
      ],
      blue: [
        { teamKey: "frc4", autoEpa: 10, teleopEpa: 20, endgameEpa: 5 },
        { teamKey: "frc5", autoEpa: 8, teleopEpa: 18, endgameEpa: 4 },
        { teamKey: "frc6", autoEpa: 9, teleopEpa: 16, endgameEpa: 4 },
      ],
    });
    expect(isScorePredictionSkip(skipped)).toBe(true);
    if (!isScorePredictionSkip(skipped)) return;
    expect(skipped.skipReason.length).toBeGreaterThan(10);
  });

  it("explains the top drivers in student-facing words", () => {
    const [row] = fixtureSeasonRows();
    const prediction = predictAllianceScores(row!);
    expect(isScorePredictionSkip(prediction)).toBe(false);
    if (isScorePredictionSkip(prediction)) return;
    expect(prediction.drivers.length).toBeGreaterThan(0);
    expect(prediction.drivers.join(" ")).toMatch(/auto|climb/i);
    expect(prediction.errorBand).toBeGreaterThan(0);
  });

  it("reports honest metrics on the fixture (not a live TBA claim)", () => {
    const metrics = scorePredictionMetrics(fixtureSeasonRows());
    expect(metrics.n).toBeGreaterThan(0);
    expect(metrics.mae).toBeGreaterThan(0);
    expect(metrics.within3).toBeGreaterThanOrEqual(0);
    expect(metrics.within3).toBeLessThanOrEqual(1);
    expect(metrics.modelVersion).toBe("calibrated-linear-v1");
  });
});
