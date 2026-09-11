import { describe, expect, it } from "vitest";
import {
  DEFAULT_ERROR_BAND,
  FIXTURE_ERROR_BAND,
  errorBandFromMae,
  fixtureSeasonRows,
  isScorePredictionSkip,
  predictAllianceScores,
  scorePredictionMetrics,
  typicalScoreErrorCopy,
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
    expect(skipped.skipReason).not.toMatch(/\bEPA\b/);
    expect(skipped.skipReason).not.toMatch(/\bOPR\b/);
  });

  it("explains the top drivers in student-facing words", () => {
    const [row] = fixtureSeasonRows();
    const prediction = predictAllianceScores(row!);
    expect(isScorePredictionSkip(prediction)).toBe(false);
    if (isScorePredictionSkip(prediction)) return;
    expect(prediction.drivers.length).toBeGreaterThan(0);
    expect(prediction.drivers.join(" ")).toMatch(/auto|climb/i);
    expect(prediction.errorBand).toBe(FIXTURE_ERROR_BAND);
  });

  it("reports honest metrics on the fixture (not a live TBA claim)", () => {
    const metrics = scorePredictionMetrics(fixtureSeasonRows());
    expect(metrics.n).toBe(4);
    expect(metrics.mae).toBe(89.7);
    expect(metrics.rmse).toBe(89.88);
    expect(metrics.within3).toBe(0);
    expect(metrics.within5).toBe(0);
    expect(metrics.modelVersion).toBe("calibrated-linear-v1");
  });

  it("uses the fixture MAE as the UI band, not a placeholder 8", () => {
    expect(errorBandFromMae(Number.NaN)).toBe(1);
    expect(errorBandFromMae(-4)).toBe(1);
    expect(errorBandFromMae(0)).toBe(1);
    expect(errorBandFromMae(89.7)).toBe(90);
    const metrics = scorePredictionMetrics(fixtureSeasonRows());
    expect(errorBandFromMae(metrics.mae)).toBe(FIXTURE_ERROR_BAND);
    expect(FIXTURE_ERROR_BAND).toBe(90);
    expect(DEFAULT_ERROR_BAND).toBe(FIXTURE_ERROR_BAND);
    expect(typicalScoreErrorCopy(FIXTURE_ERROR_BAND)).toBe("typical error ±90 (last measured set)");
    const [row] = fixtureSeasonRows();
    const overridden = predictAllianceScores(row!, { errorBand: 12.4 });
    expect(isScorePredictionSkip(overridden)).toBe(false);
    if (isScorePredictionSkip(overridden)) return;
    expect(overridden.errorBand).toBe(12);
  });
});
