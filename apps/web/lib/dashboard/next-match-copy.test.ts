import { describe, expect, it } from "vitest";
import { nextMatchDriverLines, nextMatchScoreLine } from "./next-match-copy";

describe("nextMatchScoreLine", () => {
  it("prints two alliance totals, not a dash range", () => {
    expect(nextMatchScoreLine({ redPredicted: 94.4, bluePredicted: 81.2, errorBand: 90 })).toBe(
      "Red 94 · Blue 81 · typical error ±90 (last measured set)",
    );
  });

  it("omits the band when it is missing", () => {
    expect(nextMatchScoreLine({ redPredicted: 10, bluePredicted: 12 })).toBe("Red 10 · Blue 12");
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
