import { describe, expect, it } from "vitest";
import {
  allianceScoreSpread,
  lovatWinProbability,
  predictUnscoredMatch,
  standardNormalCdf,
} from "../src/lovat-win";

describe("standardNormalCdf", () => {
  it("is 0.5 at 0 and grows toward 1", () => {
    expect(standardNormalCdf(0)).toBeCloseTo(0.5, 4);
    expect(standardNormalCdf(1.96)).toBeCloseTo(0.975, 2);
    expect(standardNormalCdf(-1.96)).toBeCloseTo(0.025, 2);
  });
});

describe("lovatWinProbability", () => {
  it("is a toss-up when alliances have the same spread", () => {
    const even = allianceScoreSpread([
      { teamKey: "frc1", mean: 50, std: 10 },
      { teamKey: "frc2", mean: 50, std: 10 },
      { teamKey: "frc3", mean: 50, std: 10 },
    ]);
    expect(even).not.toBeNull();
    const win = lovatWinProbability(even!, even!);
    expect(win?.redWinPct).toBeCloseTo(0.5, 3);
    expect(win?.blueWinPct).toBeCloseTo(0.5, 3);
    expect(win?.redPredicted).toBe(150);
  });

  it("gives blue a small left-tail when red is clearly ahead", () => {
    const red = allianceScoreSpread([{ teamKey: "frc1", mean: 180, std: 10 }])!;
    const blue = allianceScoreSpread([{ teamKey: "frc2", mean: 150, std: 10 }])!;
    const win = lovatWinProbability(red, blue)!;
    // z(0) = -30 / sqrt(200) ≈ -2.12 → Φ ≈ 0.017
    expect(win.blueWinPct).toBeCloseTo(0.017, 2);
    expect(win.redWinPct).toBeGreaterThan(0.95);
  });

  it("returns null when the differential has zero width", () => {
    const flat = allianceScoreSpread([{ teamKey: "frc1", mean: 40, std: 0 }])!;
    expect(lovatWinProbability(flat, flat)).toBeNull();
  });
});

describe("predictUnscoredMatch", () => {
  it("skips the match when any robot is missing a real rating", () => {
    expect(
      predictUnscoredMatch({
        red: [
          { teamKey: "frc1", mean: 40 },
          { teamKey: "frc2", mean: null },
        ],
        blue: [{ teamKey: "frc3", mean: 40 }],
        fieldStd: 12,
      }),
    ).toBeNull();
  });

  it("returns predicted scores without a win % when this event has no spread yet", () => {
    const prediction = predictUnscoredMatch({
      red: [
        { teamKey: "frc1", mean: 40 },
        { teamKey: "frc2", mean: 30 },
      ],
      blue: [{ teamKey: "frc3", mean: 50 }],
      fieldStd: null,
    });
    expect(prediction).toEqual({
      redPredicted: 70,
      bluePredicted: 50,
      redWinPct: null,
      blueWinPct: null,
    });
  });

  it("uses this event's spread for win % when teams have no match-to-match std", () => {
    const prediction = predictUnscoredMatch({
      red: [{ teamKey: "frc1", mean: 180 }],
      blue: [{ teamKey: "frc2", mean: 150 }],
      fieldStd: 10,
    });
    expect(prediction?.redPredicted).toBe(180);
    expect(prediction?.blueWinPct).toBeCloseTo(0.017, 2);
  });
});
