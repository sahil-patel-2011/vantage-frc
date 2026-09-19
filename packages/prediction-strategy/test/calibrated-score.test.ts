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
    expect(metrics.mae).toBe(3.75);
    expect(metrics.rmse).toBe(4.89);
    expect(metrics.within3).toBe(0.5);
    expect(metrics.within5).toBe(0.5);
    expect(metrics.modelVersion).toBe("calibrated-linear-v2");
  });

  it("uses the fixture MAE as the UI band, not a placeholder 8", () => {
    expect(errorBandFromMae(Number.NaN)).toBe(1);
    expect(errorBandFromMae(-4)).toBe(1);
    expect(errorBandFromMae(0)).toBe(1);
    expect(errorBandFromMae(3.75)).toBe(4);
    const metrics = scorePredictionMetrics(fixtureSeasonRows());
    expect(errorBandFromMae(metrics.mae)).toBe(FIXTURE_ERROR_BAND);
    expect(FIXTURE_ERROR_BAND).toBe(4);
    expect(DEFAULT_ERROR_BAND).toBe(FIXTURE_ERROR_BAND);
    expect(typicalScoreErrorCopy(FIXTURE_ERROR_BAND)).toBe("typical error ±4 (last measured set)");
    const [row] = fixtureSeasonRows();
    const overridden = predictAllianceScores(row!, { errorBand: 12.4 });
    expect(isScorePredictionSkip(overridden)).toBe(false);
    if (isScorePredictionSkip(overridden)) return;
    expect(overridden.errorBand).toBe(12);
  });
});

describe("per-match confidence, as opposed to how the model does on average", () => {
  const trio = (prefix: string, over: Record<string, unknown> = {}) =>
    [1, 2, 3].map((n) => ({
      teamKey: `frc${prefix}${n}`,
      autoEpa: 10,
      teleopEpa: 25,
      endgameEpa: 8,
      ...over,
    }));

  const predict = (over: Record<string, unknown> = {}, blueOver: Record<string, unknown> = {}) =>
    predictAllianceScores({
      matchKey: "2026test_qm1",
      red: trio("R", over) as never,
      blue: trio("B", blueOver) as never,
    });

  it("gives two identical alliances a coin flip", () => {
    const prediction = predict();
    expect(isScorePredictionSkip(prediction)).toBe(false);
    if (isScorePredictionSkip(prediction)) return;
    expect(prediction.redWinProbability).toBeCloseTo(0.5, 2);
  });

  it("is less sure about robots that swing, at the same predicted score", () => {
    // The whole reason this exists: `errorBand` cannot tell these apart,
    // because it is a property of the model and not of the match.
    const steady = predict({ matchSd: 2 }, { matchSd: 2 });
    const wild = predict({ matchSd: 30 }, { matchSd: 30 });
    if (isScorePredictionSkip(steady) || isScorePredictionSkip(wild)) throw new Error("skipped");

    expect(wild.redPredicted).toBe(steady.redPredicted);
    expect(wild.errorBand).toBe(steady.errorBand);
    expect(wild.redBand).toBeGreaterThan(steady.redBand * 2);
  });

  it("widens when a robot on the field keeps dying, and says whose fault that is", () => {
    const breaking = predictAllianceScores({
      matchKey: "2026test_qm2",
      red: [
        {
          teamKey: "frc6925",
          autoEpa: 14,
          teleopEpa: 40,
          endgameEpa: 10,
          matchSd: 6,
          scouted: {
            teamKey: "frc6925",
            matches: 9,
            meanAuto: 14,
            meanTeleop: 40,
            meanEndgame: 10,
            meanTotal: 64,
            shrunkTotal: 62,
            climbRate: 0.8,
            disabledRate: 0.35,
            defenseRate: 0,
            confidence: "medium",
            sampleNote: "9 matches",
          },
        },
        ...(trio("R", { matchSd: 6 }).slice(1) as never[]),
      ] as never,
      blue: trio("B", { matchSd: 6 }) as never,
    });
    const solid = predict({ matchSd: 6 }, { matchSd: 6 });
    if (isScorePredictionSkip(breaking) || isScorePredictionSkip(solid)) throw new Error("skipped");

    expect(breaking.redBand).toBeGreaterThan(solid.redBand);
    expect(breaking.confidence).toContain("6925");
    expect(breaking.confidence).toContain("dying on the field");
  });

  it("never says a match is certain", () => {
    const blowout = predictAllianceScores({
      matchKey: "2026test_qm3",
      red: trio("R", { autoEpa: 40, teleopEpa: 120, endgameEpa: 30, matchSd: 1 }) as never,
      blue: trio("B", { autoEpa: 1, teleopEpa: 2, endgameEpa: 0, matchSd: 1 }) as never,
    });
    if (isScorePredictionSkip(blowout)) throw new Error("skipped");
    expect(blowout.redWinProbability).toBeLessThanOrEqual(0.98);
    expect(blowout.redWinProbability).toBeGreaterThan(0.8);
  });

  it("leaves errorBand alone, including an explicit override", () => {
    // Adding per-match confidence must not quietly redefine the number the
    // widget has always shown, or an override that a backtest set.
    const [row] = fixtureSeasonRows();
    const overridden = predictAllianceScores(row!, { errorBand: 12.4 });
    if (isScorePredictionSkip(overridden)) throw new Error("skipped");
    expect(overridden.errorBand).toBe(12);
    expect(overridden.redBand).toBeGreaterThan(0);
  });
});
