import { describe, expect, it } from "vitest";
import { buildAllianceWinBreakdown, allianceWinProbability } from "./alliance-outcome";
import { DEFAULT_LOGISTIC_SCALE } from "./calibration";
import { algorithmForSeason } from "./season-algorithm";
import type { MatchPredictionInput, TeamSeasonSignal } from "./types";

/**
 * These check the seam, not the maths.
 *
 * The maths is tested in calibration.test and shrinkage.test. What is easy to
 * get wrong — and impossible to see from those — is wiring a correct
 * improvement into the engine in a way that silently does nothing. Every test
 * here exists to prove a number actually moved.
 */

const YEAR = 2026;

function season(teamKey: string, epa: number, matches: number): TeamSeasonSignal {
  return { teamKey, year: YEAR, matches, epa, source: "statbotics" };
}

/** A lopsided match: a flattered two-match team carrying a weak alliance. */
function lopsided(overrides: Partial<MatchPredictionInput> = {}): MatchPredictionInput {
  return {
    matchKey: "2026gagai_qm1",
    currentYear: YEAR,
    red: ["frc-thin", "frc-r2", "frc-r3"],
    blue: ["frc-b1", "frc-b2", "frc-b3"],
    seasons: [
      // Two matches, both lucky. This is the Friday-morning problem.
      season("frc-thin", 95, 2),
      season("frc-r2", 30, 40),
      season("frc-r3", 30, 40),
      season("frc-b1", 45, 40),
      season("frc-b2", 45, 40),
      season("frc-b3", 45, 40),
    ],
    ...overrides,
  };
}

describe("small-sample correction reaches the prediction", () => {
  it("moves the probability when a field prior is supplied", () => {
    // If this ever stops being true, the correction has been wired to nothing.
    const without = buildAllianceWinBreakdown(lopsided());
    const with_ = buildAllianceWinBreakdown(lopsided({ shrink: { centre: 40, k: 8 } }));
    expect(with_.pRed).not.toBe(without.pRed);
  });

  it("takes the shine off a team flattered by two matches", () => {
    const without = buildAllianceWinBreakdown(lopsided());
    const with_ = buildAllianceWinBreakdown(lopsided({ shrink: { centre: 40, k: 8 } }));
    expect(with_.pRed).toBeLessThan(without.pRed);

    const thinBefore = without.red.find((row) => row.teamKey === "frc-thin")!;
    const thinAfter = with_.red.find((row) => row.teamKey === "frc-thin")!;
    expect(thinAfter.rating).toBeLessThan(thinBefore.rating);
  });

  it("barely touches a team with a full season behind it", () => {
    const without = buildAllianceWinBreakdown(lopsided());
    const with_ = buildAllianceWinBreakdown(lopsided({ shrink: { centre: 40, k: 8 } }));
    const settledBefore = without.blue.find((row) => row.teamKey === "frc-b1")!;
    const settledAfter = with_.blue.find((row) => row.teamKey === "frc-b1")!;
    const thinBefore = without.red.find((row) => row.teamKey === "frc-thin")!;
    const thinAfter = with_.red.find((row) => row.teamKey === "frc-thin")!;
    expect(Math.abs(settledAfter.rating - settledBefore.rating)).toBeLessThan(
      Math.abs(thinAfter.rating - thinBefore.rating),
    );
  });

  it("changes nothing at all when no field prior is supplied", () => {
    // Behaviour must be identical for any caller that has not been updated.
    // A silent change to every stored prediction is not an improvement.
    const a = buildAllianceWinBreakdown(lopsided());
    const b = buildAllianceWinBreakdown(lopsided({ shrink: undefined }));
    expect(a.pRed).toBe(b.pRed);
  });

  it("is refused by a season whose algorithm does not use it", () => {
    // 2020 runs the legacy row, which takes every record at face value. Passing
    // a prior must not quietly re-score an old match with new maths.
    const legacy = { ...lopsided(), currentYear: 2020 };
    const plain = buildAllianceWinBreakdown(legacy);
    const withPrior = buildAllianceWinBreakdown({ ...legacy, shrink: { centre: 40, k: 8 } });
    expect(withPrior.pRed).toBe(plain.pRed);
  });

  it("survives a nonsense pull rather than dividing by it", () => {
    for (const k of [0, -5, Number.NaN]) {
      const result = buildAllianceWinBreakdown(lopsided({ shrink: { centre: 40, k } }));
      expect(Number.isFinite(result.pRed), `k=${k}`).toBe(true);
      expect(result.pRed, `k=${k}`).toBeGreaterThan(0);
      expect(result.pRed, `k=${k}`).toBeLessThan(1);
    }
  });
});

describe("the win curve is the season's, not a constant", () => {
  it("still reproduces the legacy curve exactly for an old season", () => {
    // Stored predictions from before any of this must reproduce to the digit.
    const legacy = algorithmForSeason(2020);
    expect(legacy.effectiveScale).toBe(DEFAULT_LOGISTIC_SCALE);
    const breakdown = buildAllianceWinBreakdown({ ...lopsided(), currentYear: 2020 });
    const red = breakdown.red.reduce((sum, row) => sum + row.rating, 0);
    const blue = breakdown.blue.reduce((sum, row) => sum + row.rating, 0);
    expect(breakdown.pRed).toBeCloseTo(
      allianceWinProbability(red, blue, DEFAULT_LOGISTIC_SCALE),
      3,
    );
  });

  it("uses whatever scale the season's row carries", () => {
    const current = algorithmForSeason(YEAR);
    const breakdown = buildAllianceWinBreakdown(lopsided());
    const red = breakdown.red.reduce((sum, row) => sum + row.rating, 0);
    const blue = breakdown.blue.reduce((sum, row) => sum + row.rating, 0);
    expect(breakdown.pRed).toBeCloseTo(
      allianceWinProbability(red, blue, current.effectiveScale),
      3,
    );
  });

  it("falls back rather than dividing by an unusable scale", () => {
    expect(allianceWinProbability(10, 0, 0)).toBe(allianceWinProbability(10, 0, DEFAULT_LOGISTIC_SCALE));
    expect(allianceWinProbability(10, 0, -3)).toBe(allianceWinProbability(10, 0, DEFAULT_LOGISTIC_SCALE));
    expect(allianceWinProbability(10, 0, Number.NaN)).toBe(
      allianceWinProbability(10, 0, DEFAULT_LOGISTIC_SCALE),
    );
  });
});

describe("the prediction says which maths produced it", () => {
  it("carries the provenance line in its caveats", () => {
    const caveats = buildAllianceWinBreakdown(lopsided()).caveats.join(" ");
    expect(caveats).toMatch(/win curve/i);
  });

  it("admits the curve is unmeasured rather than implying it was fitted", () => {
    const caveats = buildAllianceWinBreakdown(lopsided()).caveats.join(" ");
    expect(caveats).toMatch(/not measured/i);
  });

  it("warns that the legacy season takes thin records at face value", () => {
    const caveats = buildAllianceWinBreakdown({ ...lopsided(), currentYear: 2020 }).caveats.join(" ");
    expect(caveats).toMatch(/face value/i);
  });
});
