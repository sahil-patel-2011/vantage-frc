import { FIXTURE_ERROR_BAND } from "@vantage/prediction-strategy";
import { describe, expect, it } from "vitest";
import { nextMatchDriverLines, nextMatchScoreLine } from "./next-match-copy";

describe("nextMatchScoreLine", () => {
  it("prints two alliance totals, not a dash range", () => {
    expect(nextMatchScoreLine({ redPredicted: 94.4, bluePredicted: 81.2, errorBand: FIXTURE_ERROR_BAND })).toBe(
      "Red 94 · Blue 81 · typical error ±4 (last measured set)",
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
