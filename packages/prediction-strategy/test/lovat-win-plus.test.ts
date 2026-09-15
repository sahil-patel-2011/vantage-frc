import { describe, expect, it } from "vitest";
import { allianceScoreSpread, lovatWinProbability } from "../src/lovat-win";
import {
  allianceStdWithCorr,
  blendEventAndRecentMean,
  lovatWinProbabilityPlus,
  predictUnscoredMatchPlus,
  smallSampleTemperature,
  standardNormalCdfPlus,
} from "../src/lovat-win-plus";

describe("standardNormalCdfPlus", () => {
  it("matches 0.5 at 0 and is tighter in the far tail than a coin flip", () => {
    expect(standardNormalCdfPlus(0)).toBeCloseTo(0.5, 5);
    expect(standardNormalCdfPlus(1.96)).toBeGreaterThan(0.97);
    expect(standardNormalCdfPlus(-1.96)).toBeLessThan(0.03);
  });
});

describe("allianceStdWithCorr", () => {
  it("matches independent √Σσ² when ρ is omitted", () => {
    const teams = [
      { teamKey: "frc1", mean: 50, std: 10 },
      { teamKey: "frc2", mean: 50, std: 10 },
    ];
    expect(allianceStdWithCorr(teams)).toBeCloseTo(Math.sqrt(200), 6);
    expect(allianceStdWithCorr(teams, 0)).toBeCloseTo(Math.sqrt(200), 6);
  });

  it("raises alliance σ when a measured positive ρ is supplied", () => {
    const teams = [
      { teamKey: "frc1", mean: 50, std: 10 },
      { teamKey: "frc2", mean: 50, std: 10 },
    ];
    expect(allianceStdWithCorr(teams, 0.2)!).toBeGreaterThan(allianceStdWithCorr(teams, 0)!);
  });
});

describe("lovatWinProbabilityPlus", () => {
  it("stays a toss-up on equal alliances", () => {
    const even = allianceScoreSpread([
      { teamKey: "frc1", mean: 50, std: 10 },
      { teamKey: "frc2", mean: 50, std: 10 },
      { teamKey: "frc3", mean: 50, std: 10 },
    ])!;
    const win = lovatWinProbabilityPlus(even, even)!;
    expect(win.redWinPct).toBeCloseTo(0.5, 3);
    expect(win.blueWinPct).toBeCloseTo(0.5, 3);
  });

  it("is less certain than raw Lovat when the card is tiny (temperature > 1)", () => {
    const red = allianceScoreSpread([{ teamKey: "frc1", mean: 180, std: 10 }])!;
    const blue = allianceScoreSpread([{ teamKey: "frc2", mean: 150, std: 10 }])!;
    const lovat = lovatWinProbability(red, blue)!;
    const plus = lovatWinProbabilityPlus(red, blue, { robotCount: 2 })!;
    expect(plus.redWinPct).toBeLessThan(lovat.redWinPct);
    expect(plus.blueWinPct).toBeGreaterThan(lovat.blueWinPct);
  });

  it("never invents a win % when σ collapses", () => {
    const flat = allianceScoreSpread([{ teamKey: "frc1", mean: 40, std: 0 }])!;
    expect(lovatWinProbabilityPlus(flat, flat)).toBeNull();
  });
});

describe("blendEventAndRecentMean", () => {
  it("returns null when both sides are missing — never 0-fills", () => {
    expect(blendEventAndRecentMean(null, null, 3)).toBeNull();
  });

  it("keeps the event mean when there is no recent sample", () => {
    expect(blendEventAndRecentMean(80, null, 0)).toBe(80);
  });

  it("weights last-N by n/(n+4) when both exist", () => {
    const blended = blendEventAndRecentMean(80, 100, 4);
    expect(blended).toBeCloseTo(90, 5);
  });
});

describe("predictUnscoredMatchPlus", () => {
  it("skips the match when any robot is missing a real rating", () => {
    expect(
      predictUnscoredMatchPlus({
        red: [
          { teamKey: "frc1", mean: 40 },
          { teamKey: "frc2", mean: null },
        ],
        blue: [{ teamKey: "frc3", mean: 40 }],
        fieldStd: 12,
      }),
    ).toBeNull();
  });

  it("returns scores without a win % when this event has no spread", () => {
    const prediction = predictUnscoredMatchPlus({
      red: [{ teamKey: "frc1", mean: 40 }],
      blue: [{ teamKey: "frc2", mean: 50 }],
      fieldStd: null,
    });
    expect(prediction).toEqual({
      redPredicted: 40,
      bluePredicted: 50,
      redWinPct: null,
      blueWinPct: null,
    });
  });
});

describe("smallSampleTemperature", () => {
  it("is 1 once six robots are on the card", () => {
    expect(smallSampleTemperature(6)).toBe(1);
    expect(smallSampleTemperature(2)).toBeGreaterThan(1);
  });
});
