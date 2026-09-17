import { describe, expect, it } from "vitest";
import { buildAllianceWinBreakdown, allianceWinProbability } from "./alliance-outcome";
import {
  DEFENCE_SHARE_FLOOR,
  MIN_LEVER_GAIN_PP,
  winLevers,
  type WinLeverInput,
} from "./win-levers";
import type { TeamSeasonSignal } from "./types";

const YEAR = 2026;

function season(teamKey: string, epa: number, matches = 40): TeamSeasonSignal {
  return { teamKey, year: YEAR, matches, epa, source: "statbotics" };
}

const BASE: WinLeverInput = {
  teamKey: "frc6925",
  currentYear: YEAR,
  seasons: [season("frc6925", 45)],
  partnerRating: 70,
  opponents: [
    { teamKey: "frc254", rating: 60 },
    { teamKey: "frc1678", rating: 35 },
    { teamKey: "frc9999", rating: 25 },
  ],
};

describe("winLevers", () => {
  it("bends the same curve the prediction was drawn on", () => {
    // If these two ever disagree, the advice contradicts the number above it.
    const breakdown = buildAllianceWinBreakdown({
      matchKey: "2026gagai_qm1",
      currentYear: YEAR,
      red: ["frc6925"],
      blue: ["frc254"],
      seasons: [season("frc6925", 45), season("frc254", 60)],
    });
    const redTotal = breakdown.red[0].rating;
    const blueTotal = breakdown.blue[0].rating;
    expect(allianceWinProbability(redTotal, blueTotal)).toBeCloseTo(breakdown.pRed, 3);
  });

  it("says nothing about penalties for a team with no measured fouls", () => {
    // Advice we cannot support is worse than silence: it teaches the drive team
    // that the panel guesses.
    const levers = winLevers(BASE);
    expect(levers.map((l) => l.id)).not.toContain("penalties");
  });

  it("offers a clean-match ceiling worth exactly the measured penalty", () => {
    const levers = winLevers({
      ...BASE,
      operational: { teamKey: "frc6925", scoutSample: 30, foulRate: 6 },
    });
    const penalties = levers.find((l) => l.id === "penalties");
    expect(penalties).toBeDefined();
    expect(penalties?.isCeiling).toBe(true);
    expect(penalties?.ratingGain).toBeGreaterThan(0);
    expect(penalties?.gain).toBeGreaterThan(0);
    expect(penalties?.detail).toContain("6");
  });

  it("does not offer a reliability lever to a team that already finishes everything", () => {
    const levers = winLevers({
      ...BASE,
      operational: { teamKey: "frc6925", scoutSample: 30, reliability: 100 },
    });
    expect(levers.map((l) => l.id)).not.toContain("reliability");
  });

  it("drops a reliability lever that moves nothing because nobody has scouted", () => {
    // reliability only enters the rating through the scout blend, so with a zero
    // sample the honest gain is zero — and a zero-gain lever is a lie of omission.
    const levers = winLevers({
      ...BASE,
      operational: { teamKey: "frc6925", scoutSample: 0, reliability: 60 },
    });
    expect(levers.map((l) => l.id)).not.toContain("reliability");
  });

  it("names the opponent worth defending when one of them is carrying", () => {
    const levers = winLevers(BASE);
    const defence = levers.find((l) => l.id === "defend-top-opponent");
    expect(defence).toBeDefined();
    expect(defence?.title).toBe("Defend 254");
    expect(defence?.detail).toContain("254");
  });

  it("stays quiet about defence when the opposing alliance is even", () => {
    const even = winLevers({
      ...BASE,
      opponents: [
        { teamKey: "frc254", rating: 40 },
        { teamKey: "frc1678", rating: 40 },
        { teamKey: "frc9999", rating: 40 },
      ],
    });
    // A third each is below the floor: defending one robot on an even alliance
    // costs more of your own output than it takes off theirs.
    expect(40 / 120).toBeLessThan(DEFENCE_SHARE_FLOOR);
    expect(even.map((l) => l.id)).not.toContain("defend-top-opponent");
  });

  it("ranks levers by what they are actually worth", () => {
    const levers = winLevers({
      ...BASE,
      operational: { teamKey: "frc6925", scoutSample: 40, foulRate: 8, reliability: 55 },
    });
    const ranked = levers.filter((l) => l.id !== "scoring-rate");
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1].gain).toBeGreaterThanOrEqual(ranked[i].gain);
    }
  });

  it("hides levers too small to be worth an afternoon", () => {
    const levers = winLevers({
      ...BASE,
      operational: { teamKey: "frc6925", scoutSample: 30, foulRate: 0.01 },
    });
    for (const lever of levers) {
      if (lever.id === "scoring-rate") continue;
      expect(lever.gain).toBeGreaterThanOrEqual(MIN_LEVER_GAIN_PP);
    }
  });

  it("always prices ten points, so an unmeasured idea can still be weighed", () => {
    const levers = winLevers(BASE);
    const rate = levers.find((l) => l.id === "scoring-rate");
    expect(rate).toBeDefined();
    expect(rate?.gain).toBeGreaterThan(0);
    // It is context, not an action — it must never outrank a real lever.
    expect(levers[levers.length - 1].id).toBe("scoring-rate");
  });

  it("returns nothing at all when neither alliance has been rated", () => {
    // A 50/50 built from two zeros is not a prediction, so nothing may be
    // derived from it.
    expect(
      winLevers({
        teamKey: "frc6925",
        currentYear: YEAR,
        seasons: [],
        partnerRating: 0,
        opponents: [],
      }),
    ).toEqual([]);
  });

  it("quotes every lever against one shared baseline", () => {
    // Each lever reports where it lands and how far it moved. Subtracting one
    // from the other must give the same starting point every time — otherwise
    // two levers are being measured from different matches and their ranking
    // against each other is meaningless.
    const levers = winLevers({
      ...BASE,
      operational: { teamKey: "frc6925", scoutSample: 40, foulRate: 8, reliability: 55 },
    });
    expect(levers.length).toBeGreaterThan(1);
    const baselines = levers.map((l) => l.probabilityAfter - l.gain / 100);
    for (const baseline of baselines) {
      expect(baseline).toBeCloseTo(baselines[0], 2);
    }
  });
});
