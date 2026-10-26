import { FIXTURE_ERROR_BAND } from "@vantage/prediction-strategy";
import { describe, expect, it } from "vitest";
import { nextMatchCategoryLine, nextMatchDriverLines, nextMatchScoreLine } from "./next-match-copy";

describe("nextMatchScoreLine", () => {
  it("prints two alliance totals, not a dash range", () => {
    expect(nextMatchScoreLine({ redPredicted: 94.4, bluePredicted: 81.2, errorBand: FIXTURE_ERROR_BAND })).toBe(
      "Red 94 · Blue 81 · typical error ±36 (last measured set)",
    );
  });

  it("omits the band when it is missing", () => {
    expect(nextMatchScoreLine({ redPredicted: 10, bluePredicted: 12 })).toBe("Red 10 · Blue 12");
  });

  it("prefers the band that belongs to this match over the model average", () => {
    // Two alliances in one match are not equally predictable — three robots
    // nobody has watched and three with a season of history sit on opposite
    // sides of the same card.
    expect(
      nextMatchScoreLine({
        redPredicted: 94.4,
        bluePredicted: 81.2,
        errorBand: 4,
        redBand: 7,
        blueBand: 19,
      }),
    ).toBe("Red 94 ±7 · Blue 81 ±19");
  });

  it("falls back to the model average for a prediction stored before per-match bands", () => {
    expect(
      nextMatchScoreLine({ redPredicted: 94.4, bluePredicted: 81.2, errorBand: 4, redBand: null }),
    ).toBe("Red 94 · Blue 81 · typical error ±4 (last measured set)");
  });

  it("prints a measured interval as two ranges, not a dash between alliances", () => {
    expect(
      nextMatchScoreLine({
        redPredicted: 400,
        bluePredicted: 380,
        errorBand: 90,
        redBand: 90,
        blueBand: 90,
        redLow: 210,
        redHigh: 590,
        blueLow: 190,
        blueHigh: 570,
      }),
    ).toBe("Red 210 to 590 · Blue 190 to 570");
  });

  it("does not print a zero band as if it were a measurement", () => {
    expect(nextMatchScoreLine({ redPredicted: 50, bluePredicted: 50, redBand: 0, blueBand: 0 })).toBe(
      "Red 50 · Blue 50",
    );
  });
});

describe("nextMatchDriverLines", () => {
  it("prefers live scoreDrivers over stored keyFactors", () => {
    expect(
      nextMatchDriverLines({
        scoreDrivers: ["254's auto is 18.0 points on red"],
        keyFactors: [{ name: "this-season rules", impact: 1 }],
      }),
    ).toEqual(["254's auto is 18.0 points on red"]);
  });

  it("falls back to named key factors with string impact", () => {
    expect(
      nextMatchDriverLines({
        keyFactors: [
          { name: "Climb", impact: "1323 hangs most matches" },
          { name: "numeric-only", impact: 1 },
        ],
      }),
    ).toEqual(["Climb — 1323 hangs most matches", "numeric-only"]);
  });
});

describe("nextMatchCategoryLine", () => {
  it("prints red then blue for each piece and leaves fouls off the line", () => {
    expect(
      nextMatchCategoryLine({
        redAuto: 41.6,
        redTeleop: 210.2,
        redEndgame: 0,
        blueAuto: 30.4,
        blueTeleop: 188.4,
        blueEndgame: 10,
      }),
    ).toBe("Red / blue · Auto 42 / 30 · Teleop 210 / 188 · Endgame 0 / 10");
  });

  it("uses a measured piece range when that piece has one", () => {
    expect(
      nextMatchCategoryLine({
        redAuto: 42,
        redTeleop: 210,
        redEndgame: 0,
        blueAuto: 30,
        blueTeleop: 188,
        blueEndgame: 10,
        ranges: { auto: { redLow: 20, redHigh: 60, blueLow: 10, blueHigh: 50 } },
      }),
    ).toBe("Red / blue · Auto 20 to 60 / 10 to 50 · Teleop 210 / 188 · Endgame 0 / 10");
  });

  it("says nothing when a piece is missing", () => {
    expect(
      nextMatchCategoryLine({
        redAuto: null,
        redTeleop: null,
        redEndgame: null,
        blueAuto: null,
        blueTeleop: null,
        blueEndgame: null,
      }),
    ).toBeNull();
  });
});
