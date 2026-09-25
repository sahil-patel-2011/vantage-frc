import { describe, expect, it } from "vitest";
import { kioskBrandLine, kioskHeroSplit, kioskOpponentIntel, kioskSides, kioskWinLine } from "./kiosk-view";

const match = {
  matchKey: "2026gacmp_qm37",
  compLevel: "qm",
  matchNumber: 37,
  scheduledTime: null,
  redAlliance: { teamKeys: ["frc6925", "frc7457", "frc67"] },
  blueAlliance: { teamKeys: ["frc1678", "frc1323", "frc254"] },
};

const prediction = {
  matchKey: "2026gacmp_qm37",
  pRed: 0.28,
  pBlue: 0.72,
  confidenceLow: 0.19,
  confidenceHigh: 0.37,
  modelVersion: "v3",
  keyFactors: [],
  caveats: [],
  scoredAt: null,
};

describe("pit TV view", () => {
  it("names the team once and says where it is", () => {
    expect(kioskBrandLine({ name: "Team 6925", teamNumber: 6925 }, "Peachtree District Championship")).toBe(
      "Team 6925 · Peachtree District Championship",
    );
    expect(kioskBrandLine({ name: "Ninjineers", teamNumber: 6925 }, null)).toBe("Ninjineers · Team 6925");
  });

  it("splits partners and opponents from the posted alliances", () => {
    expect(kioskSides(match, 6925)).toMatchObject({ ourColor: "red", partners: ["7457", "67"], opponents: ["1678", "1323", "254"] });
    expect(kioskSides(match, 9999).ourColor).toBeNull();
  });

  it("labels the win chance with the match and our colour", () => {
    expect(kioskWinLine({ nextMatch: match, prediction }, 6925)).toEqual({ value: "28% to win", detail: "Qual 37 · from our saved prediction" });
  });

  it("never shows odds that belong to another match", () => {
    const old = { ...prediction, matchKey: "2026gacmp_qm36" };
    expect(kioskWinLine({ nextMatch: match, prediction: old }, 6925).value).toBe("No prediction yet");
    expect(kioskWinLine({ nextMatch: null, prediction: old }, 6925).value).toBe("No match ahead");
  });

  it("lists only opponents that were scouted", () => {
    const intel = { matchKey: "2026gacmp_qm37", ourWinPct: 28, ourColor: "red" as const, teams: [{ teamKey: "frc254", tags: ["Physical", "Strong endgame"] }] };
    expect(kioskOpponentIntel(intel, ["1678", "1323", "254"])).toEqual([{ team: "254", words: "Physical · Strong endgame" }]);
    expect(kioskOpponentIntel(null, ["254"])).toEqual([]);
  });

  it("makes panel 1 the hero", () => {
    expect(kioskHeroSplit(["a", "b", "c"])).toEqual({ hero: "a", rest: ["b", "c"] });
    expect(kioskHeroSplit([])).toEqual({ hero: null, rest: [] });
  });
});
