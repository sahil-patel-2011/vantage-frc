import { describe, expect, it } from "vitest";
import { allianceWinProbability, allianceWinProbabilityForEvent } from "../src/alliance-outcome";
import { deriveQualOrder, loadGagrQuals, measureCutoff, spearman, type SeedModel } from "./seed-replay";

/**
 * Public qualification rankings for 2026gagr (GRITS), read from
 * https://www.thebluealliance.com/event/2026gagr on 2026-10-25 with no API key.
 * Order is the published rank. Two teams appear in nine quals in the match file
 * and eight in this ranking. Qualification 16 marks both as surrogates on the
 * public match page (read 2026-10-26, no API key). The file has no surrogate
 * column, the rows are not duplicates, and the replay still counts them.
 */
const OFFICIAL = [
  1261, 2974, 6829, 8866, 1648, 1771, 4188, 4026, 3635, 4112, 1002, 9477, 6910, 8080, 1683, 6905,
  4189, 3318, 1833, 1746, 1414, 832, 6772, 3344, 10376, 5074, 11214, 9480, 10482, 5608, 5109, 5293,
  11174, 6925, 6340, 8100, 2415, 7538, 8865, 4509, 9522, 7451, 5900, 6705,
].map((team) => `frc${team}`);

const MODELS: SeedModel[] = ["before", "frozen", "ratings-fixed-curve", "ratings-event-curve"];
const CUTOFFS = [20, 30, 40];

describe("win chance follows the event's scoring level", () => {
  it("stays less sure than the fixed 12-point curve when alliances score around 150", () => {
    const fixed = allianceWinProbability(100, 80);
    const widened = allianceWinProbabilityForEvent(100, 80, 150);
    expect(fixed).toBeGreaterThan(0.8);
    expect(widened).toBeGreaterThan(0.5);
    expect(widened).toBeLessThan(fixed);
    expect(allianceWinProbabilityForEvent(100, 80, null)).toBe(fixed);
    expect(allianceWinProbabilityForEvent(80, 100, 150)).toBeCloseTo(1 - widened, 6);
  });
});

describe("2026gagr seed replay", () => {
  const quals = loadGagrQuals();
  const official = OFFICIAL;
  const derived = deriveQualOrder(quals);

  it("reads the qualification schedule and a team the public ranking agrees with", () => {
    expect(quals).toHaveLength(59);
    expect(new Set(quals.flatMap((qual) => [...qual.red, ...qual.blue])).size).toBe(44);
    const lions = derived.standings.find((row) => row.teamKey === "frc1261");
    // Public page: 8-0, average match 285.75, which is the foul-free average.
    expect(lions).toMatchObject({ rp: 24, played: 8, earned: 2286 });
    expect(lions!.earned / lions!.played).toBeCloseTo(285.75, 2);
    expect(spearman(["a", "b", "c"], ["a", "b", "c"])).toBeCloseTo(1, 6);
    expect(spearman(["a", "b", "c"], ["c", "b", "a"])).toBeCloseTo(-1, 6);
  });

  it("counts nine real qualifications for the two surrogate teams, not a duplicate row", () => {
    const appearances = (team: string) =>
      quals.filter((qual) => qual.red.includes(team) || qual.blue.includes(team));
    expect(appearances("frc2974")).toHaveLength(9);
    expect(appearances("frc1414")).toHaveLength(9);
    const signatures = quals.map((qual) =>
      [...qual.red, ...qual.blue, qual.redScore, qual.blueScore, qual.redFouls, qual.blueFouls].join(","),
    );
    expect(new Set(signatures).size).toBe(quals.length);
    const sixteenth = quals.find((qual) => qual.number === 16);
    expect(sixteenth?.red).toContain("frc2974");
    expect(sixteenth?.blue).toContain("frc1414");
  });

  it("agrees with the published ranking on the captain group, and differs in the middle", () => {
    // Win points only, against the public ranking (which also counts bonus points).
    expect(spearman(derived.order, official)).toBeCloseTo(0.974348, 4);
    const officialTop = new Set(official.slice(0, 8));
    expect(derived.order.slice(0, 8).filter((team) => officialTop.has(team))).toHaveLength(8);
    const officialRank = new Map(official.map((team, index) => [team, index + 1]));
    const gaps = derived.order.map((team, index) => Math.abs(index + 1 - officialRank.get(team)!));
    expect(gaps.filter((gap) => gap > 0)).toHaveLength(32);
    expect(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length).toBe(2);
  });

  it("measures seed order at three cutoffs", () => {
    const rows = CUTOFFS.flatMap((playedQuals) =>
      MODELS.map((model) => measureCutoff(quals, playedQuals, official, model)),
    );
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      const expected = EXPECTED.find((item) => item.playedQuals === row.playedQuals && item.model === row.model);
      expect(expected, `${row.playedQuals} ${row.model}`).toBeDefined();
      expect(row.spearmanDerived, "derived").toBeCloseTo(expected!.spearmanDerived, 3);
      expect(row.top8Derived).toBe(expected!.top8Derived);
      expect(row.spearmanOfficial, "official").toBeCloseTo(expected!.spearmanOfficial, 3);
      expect(row.top8Official).toBe(expected!.top8Official);
      expect(row.unpredicted).toBe(expected!.unpredicted);
      if (expected!.brier == null) expect(row.brier).toBeNull();
      else expect(row.brier).toBeCloseTo(expected!.brier, 3);
      expect(row.winnersRight).toBe(expected!.winnersRight);
      expect(row.winnerCalls).toBe(expected!.winnerCalls);
    }
    // The fixed 12-point curve is worse than leaving every match a coin flip after only 20 quals.
    const early = (model: SeedModel) => rows.find((row) => row.playedQuals === 20 && row.model === model)!;
    expect(early("ratings-fixed-curve").spearmanDerived).toBeLessThan(early("before").spearmanDerived);
    expect(early("ratings-fixed-curve").brier!).toBeGreaterThan(0.25);
    expect(early("ratings-event-curve").brier!).toBeLessThan(0.25);
    expect(early("ratings-event-curve").spearmanDerived).toBeGreaterThan(early("frozen").spearmanDerived);
  });
});

/** Locked to the replay on 2026-10-25. Three decimals; see docs/PREDICTION_RESULTS.md. */
const EXPECTED: Array<{
  playedQuals: number;
  model: SeedModel;
  spearmanDerived: number;
  top8Derived: number;
  spearmanOfficial: number;
  top8Official: number;
  unpredicted: number;
  brier: number | null;
  winnersRight: number | null;
  winnerCalls: number | null;
}> = [
  { playedQuals: 20, model: "before", spearmanDerived: 0.722, top8Derived: 5, spearmanOfficial: 0.673, top8Official: 5, unpredicted: 39, brier: 0.25, winnersRight: null, winnerCalls: null },
  { playedQuals: 20, model: "frozen", spearmanDerived: 0.713, top8Derived: 5, spearmanOfficial: 0.669, top8Official: 5, unpredicted: 39, brier: null, winnersRight: null, winnerCalls: null },
  { playedQuals: 20, model: "ratings-fixed-curve", spearmanDerived: 0.673, top8Derived: 5, spearmanOfficial: 0.597, top8Official: 5, unpredicted: 0, brier: 0.257, winnersRight: 27, winnerCalls: 39 },
  { playedQuals: 20, model: "ratings-event-curve", spearmanDerived: 0.736, top8Derived: 5, spearmanOfficial: 0.684, top8Official: 5, unpredicted: 0, brier: 0.218, winnersRight: 27, winnerCalls: 39 },
  { playedQuals: 30, model: "before", spearmanDerived: 0.83, top8Derived: 3, spearmanOfficial: 0.797, top8Official: 3, unpredicted: 29, brier: 0.25, winnersRight: null, winnerCalls: null },
  { playedQuals: 30, model: "frozen", spearmanDerived: 0.841, top8Derived: 3, spearmanOfficial: 0.806, top8Official: 3, unpredicted: 29, brier: null, winnersRight: null, winnerCalls: null },
  { playedQuals: 30, model: "ratings-fixed-curve", spearmanDerived: 0.86, top8Derived: 5, spearmanOfficial: 0.817, top8Official: 5, unpredicted: 0, brier: 0.189, winnersRight: 23, winnerCalls: 29 },
  { playedQuals: 30, model: "ratings-event-curve", spearmanDerived: 0.862, top8Derived: 5, spearmanOfficial: 0.816, top8Official: 5, unpredicted: 0, brier: 0.167, winnersRight: 23, winnerCalls: 29 },
  { playedQuals: 40, model: "before", spearmanDerived: 0.859, top8Derived: 5, spearmanOfficial: 0.831, top8Official: 5, unpredicted: 19, brier: 0.25, winnersRight: null, winnerCalls: null },
  { playedQuals: 40, model: "frozen", spearmanDerived: 0.859, top8Derived: 5, spearmanOfficial: 0.83, top8Official: 5, unpredicted: 19, brier: null, winnersRight: null, winnerCalls: null },
  { playedQuals: 40, model: "ratings-fixed-curve", spearmanDerived: 0.89, top8Derived: 6, spearmanOfficial: 0.85, top8Official: 6, unpredicted: 0, brier: 0.171, winnersRight: 15, winnerCalls: 19 },
  { playedQuals: 40, model: "ratings-event-curve", spearmanDerived: 0.889, top8Derived: 6, spearmanOfficial: 0.864, top8Official: 6, unpredicted: 0, brier: 0.141, winnersRight: 15, winnerCalls: 19 },
];
