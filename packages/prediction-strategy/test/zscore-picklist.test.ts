import { describe, expect, it } from "vitest";
import {
  defaultPicklistWeights,
  fieldStatsFromRows,
  populationMean,
  populationStdDev,
  rankByWeightedZScores,
  scoreTeamAgainstField,
  zScore,
  type TeamMetricRow,
} from "../src/zscore-picklist";

const lovatExample: TeamMetricRow = {
  teamKey: "frc1",
  values: { teleopPoints: 150, driverAbility: 5, totalFuelFed: 12 },
};

const field = {
  teleopPoints: { mean: 112, std: 30, n: 40 },
  driverAbility: { mean: 4, std: 2, n: 40 },
  totalFuelFed: { mean: 83, std: 50, n: 40 },
};

describe("population stats", () => {
  it("needs two real values before a field comparison is defined", () => {
    expect(populationMean([])).toBeNull();
    expect(populationStdDev([10])).toBeNull();
    expect(populationMean([10, 20])).toBe(15);
    expect(populationStdDev([10, 20])).toBe(5);
  });

  it("uses population (N) standard deviation, not sample (N-1)", () => {
    expect(populationStdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
  });
});

describe("zScore", () => {
  it("matches Lovat: (value − field mean) / field std", () => {
    expect(zScore(150, 112, 30)).toBeCloseTo(1.2667, 3);
    expect(zScore(5, 4, 2)).toBe(0.5);
    expect(zScore(12, 83, 50)).toBeCloseTo(-1.42, 4);
  });

  it("scores a zero-spread field as 0 instead of inventing a lead", () => {
    expect(zScore(40, 40, 0)).toBe(0);
  });
});

describe("scoreTeamAgainstField", () => {
  it("reproduces the Lovat picklist worked example", () => {
    const ranked = scoreTeamAgainstField(
      lovatExample,
      [
        { id: "teleopPoints", weight: 0.4 },
        { id: "driverAbility", weight: 0.3 },
        { id: "totalFuelFed", weight: 0.1 },
      ],
      field,
    );
    // (1.2667*0.4) + (0.5*0.3) + (-1.42*0.1) ≈ 0.5147
    expect(ranked.score).toBeCloseTo(0.5147, 3);
    expect(ranked.breakdown).toHaveLength(3);
  });

  it("skips a missing metric instead of filling 0", () => {
    const ranked = scoreTeamAgainstField(
      { teamKey: "frc2", values: { teleopPoints: 150 } },
      [
        { id: "teleopPoints", weight: 0.4 },
        { id: "driverAbility", weight: 0.3 },
      ],
      field,
    );
    expect(ranked.breakdown.map((item) => item.id)).toEqual(["teleopPoints"]);
    expect(ranked.score).toBeCloseTo(0.5067, 3);
  });

  it("returns null when the team has no real values", () => {
    const ranked = scoreTeamAgainstField(
      { teamKey: "frc3", values: { teleopPoints: null } },
      [{ id: "teleopPoints", weight: 1 }],
      field,
    );
    expect(ranked.score).toBeNull();
  });
});

describe("rankByWeightedZScores", () => {
  it("ranks from the event field, not a fabricated default", () => {
    const rows: TeamMetricRow[] = [
      { teamKey: "frc10", values: { totalPoints: 20 } },
      { teamKey: "frc20", values: { totalPoints: 40 } },
      { teamKey: "frc30", values: { totalPoints: 60 } },
      { teamKey: "frc40", values: {} },
    ];
    const ranked = rankByWeightedZScores(rows, [{ id: "totalPoints", weight: 1 }]);
    expect(ranked.map((row) => row.teamKey)).toEqual(["frc30", "frc20", "frc10", "frc40"]);
    expect(ranked[3]?.score).toBeNull();
    const stats = fieldStatsFromRows(rows);
    expect(stats.totalPoints?.n).toBe(3);
    expect(stats.driverAbility).toBeUndefined();
  });

  it("defaults event sliders on and scout sliders off until scout rows exist", () => {
    const weights = defaultPicklistWeights();
    expect(weights.find((item) => item.id === "totalPoints")?.weight).toBe(1);
    expect(weights.find((item) => item.id === "driverAbility")?.weight).toBe(0);
  });
});
