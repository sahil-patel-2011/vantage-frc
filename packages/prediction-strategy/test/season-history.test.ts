import { describe, expect, it } from "vitest";
import {
  normalShareBelow,
  rateTeam,
  referenceScale,
  rescaleRating,
  seasonScaleMap,
  teamTrend,
  type SeasonScale,
  type TeamSeasonSignal,
} from "../src";

// Two games that scored very differently: a field mean of 20 one year and 40 the next.
const scales: SeasonScale[] = [
  { year: 2022, mean: 18, sd: 9, teams: 3000 },
  { year: 2023, mean: 20, sd: 10, teams: 3000 },
  { year: 2024, mean: 40, sd: 20, teams: 3100 },
  { year: 2025, mean: 30, sd: 12, teams: 3200 },
  { year: 2026, mean: 35, sd: 14, teams: 3300 },
];

describe("season scale", () => {
  it("restates a past rating at the same distance from this season's field", () => {
    const map = seasonScaleMap(scales);
    const ref = referenceScale(map, 2026)!;
    // One standard deviation above 2023's field (30 vs mean 20, sd 10) → one above 2026's (35 + 14).
    expect(rescaleRating(30, 2023, map, ref)).toBe(49);
    expect(rescaleRating(30, 2026, map, ref)).toBe(30);
  });

  it("uses the latest season with enough teams when this season has no results yet", () => {
    const map = seasonScaleMap([...scales.filter((s) => s.year !== 2026), { year: 2026, mean: 10, sd: 4, teams: 6 }]);
    expect(referenceScale(map, 2026)?.year).toBe(2025);
  });

  it("leaves a rating alone when a year has no usable statistics", () => {
    const map = seasonScaleMap([{ year: 2026, mean: 35, sd: 14, teams: 3300 }]);
    expect(rescaleRating(30, 2019, map, referenceScale(map, 2026))).toBe(30);
  });

  it("reads 0.5 at the field mean and about 0.84 one deviation above", () => {
    expect(normalShareBelow(0)).toBeCloseTo(0.5, 3);
    expect(normalShareBelow(1)).toBeCloseTo(0.8413, 3);
    expect(normalShareBelow(-1)).toBeCloseTo(0.1587, 3);
  });
});

describe("rateTeam across seasons", () => {
  const signal = (year: number, epa: number, matches: number): TeamSeasonSignal => ({ teamKey: "frc1", year, epa, matches, source: "statbotics" });

  it("compares a past game's rating on this season's scale instead of averaging raw numbers", () => {
    // Equally good both years (one deviation above the field). Raw averaging would drag the
    // 2026 rating toward 2023's smaller numbers; on one scale both say 49.
    const rated = rateTeam("frc1", 2026, [signal(2026, 49, 12), signal(2023, 30, 12)], undefined, undefined, scales);
    expect(rated.rating).toBeCloseTo(49, 5);
  });

  it("does not let a long past season outvote this season's first event", () => {
    const rated = rateTeam("frc1", 2026, [signal(2026, 60, 12), signal(2025, 30, 70)], undefined, undefined, scales);
    // 2025's 30 is the 2025 field mean → 35 on 2026's scale. Weights 1 (12 matches) and 0.55 (capped).
    expect(rated.rating).toBeCloseTo((60 * 1 + 35 * 0.55) / 1.55, 5);
    expect(rated.rating).toBeGreaterThan(50);
  });

  it("is unchanged for a single season", () => {
    expect(rateTeam("frc1", 2026, [signal(2026, 42, 9)], undefined, undefined, scales).rating).toBe(42);
  });
});

describe("teamTrend", () => {
  it("says a team has been elite in plain words", () => {
    const trend = teamTrend(
      [
        { year: 2022, epa: 40 },
        { year: 2023, epa: 45 },
        { year: 2024, epa: 90 },
        { year: 2025, epa: 60 },
        { year: 2026, epa: 70 },
      ],
      scales,
      2026,
      "Team 254",
    );
    expect(trend.lines[0]).toBe("Team 254 has been in the top 10% of teams in 5 of its last 5 seasons (2022–2026).");
  });

  it("calls out a climb with the start and end", () => {
    const trend = teamTrend(
      [
        { year: 2023, epa: 15 },
        { year: 2024, epa: 40 },
        { year: 2025, epa: 42 },
        { year: 2026, epa: 56 },
      ],
      scales,
      2026,
      "Team 3091",
    );
    expect(trend.direction).toBe("rising");
    expect(trend.lines.some((line) => line.startsWith("Team 3091 is climbing: better than 31% of teams in 2023"))).toBe(true);
  });

  it("says nothing it can't back up", () => {
    expect(teamTrend([], scales, 2026).lines).toEqual([]);
    expect(teamTrend([{ year: 2019, epa: 30 }], scales, 2026).lines).toEqual([]);
    const one = teamTrend([{ year: 2026, epa: 35 }], scales, 2026, "Team 9999");
    expect(one.direction).toBe("new");
    expect(one.lines).toEqual(["Team 9999 was better than 50% of teams in 2026, its only season with results here."]);
  });
});
