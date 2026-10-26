import { describe, expect, it } from "vitest";
import { additiveParts, scoringForSeason } from "../src/season-scoring";
import { forecastMatch, isMatchForecastSkip } from "../src/walk-forward";
import type { CategorySample } from "../src/walk-forward";

describe("season scoring config", () => {
  it("lists 2026 REBUILT pieces and leaves BIOCORE without a guessed list", () => {
    const rebuilt = scoringForSeason(2026);
    expect(rebuilt.game).toBe("REBUILT");
    expect(rebuilt.categoriesKnown).toBe(true);
    expect(rebuilt.categories).toEqual(["auto", "teleop", "endgame", "foul"]);
    const biocore = scoringForSeason(2027);
    expect(biocore.game).toBe("BIOCORE");
    expect(biocore.kickoff).toBe("2027-01-09");
    expect(biocore.categoriesKnown).toBe(false);
    expect(biocore.categories).toEqual([]);
    expect(scoringForSeason(2025).categoriesKnown).toBe(false);
  });

  it("keeps a 2025 breakdown that already adds up", () => {
    const parts = additiveParts(104, {
      foulPoints: 6,
      autoPoints: 20,
      teleopPoints: 60,
      endGameBargePoints: 18,
    });
    expect(parts).toEqual({ auto: 20, teleop: 60, endgame: 18, foul: 6, additive: true });
  });

  it("takes the tower out of 2026 teleop so the four pieces match the scoreboard", () => {
    const parts = additiveParts(302, {
      foulPoints: 15,
      autoPoints: 29,
      teleopFuelPoints: 238,
      totalTeleop: 258,
      endGameTowerPoints: 20,
    });
    expect(parts).toEqual({ auto: 29, teleop: 238, endgame: 20, foul: 15, additive: true });
  });
});

describe("forecastMatch season gate", () => {
  const played: CategorySample[] = [];
  for (let order = 0; order < 6; order += 1) {
    played.push(
      { teams: ["frc1", "frc2", "frc3"], auto: 20, teleop: 80, endgame: 0, foul: 4, total: 104, order, matchKey: `m${order}` },
      { teams: ["frc4", "frc5", "frc6"], auto: 10, teleop: 70, endgame: 0, foul: 2, total: 82, order, matchKey: `m${order}` },
    );
  }

  it("predicts a total only for 2027 and says the manual is not published", () => {
    const forecast = forecastMatch({ season: 2027, red: ["frc1", "frc2", "frc3"], blue: ["frc4", "frc5", "frc6"], played });
    expect(isMatchForecastSkip(forecast)).toBe(false);
    if (isMatchForecastSkip(forecast)) return;
    expect(forecast.categoriesKnown).toBe(false);
    expect(forecast.red.auto).toBeNull();
    expect(forecast.red.teleop).toBeNull();
    expect(forecast.red.endgame).toBeNull();
    expect(forecast.confidence).toMatch(/not published/);
    expect(forecast.red.total).toBeGreaterThan(0);
  });
});
