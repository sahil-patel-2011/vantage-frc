import { describe, expect, it } from "vitest";
import { eventOpr, type AllianceResult } from "./event-opr";
import { seedOdds } from "./seed-odds";

// Six robots with known contributions; every alliance score is exactly the sum of its three.
const truth: Record<string, { auto: number; teleop: number; endgame: number }> = {
  frc1: { auto: 10, teleop: 30, endgame: 10 },
  frc2: { auto: 8, teleop: 22, endgame: 6 },
  frc3: { auto: 4, teleop: 16, endgame: 4 },
  frc4: { auto: 6, teleop: 20, endgame: 8 },
  frc5: { auto: 2, teleop: 10, endgame: 2 },
  frc6: { auto: 5, teleop: 12, endgame: 4 },
};
// Every three-robot alliance from six robots: enough independent scores to pin each one down.
const keys = Object.keys(truth);
const alliances: string[][] = [];
for (let a = 0; a < keys.length; a += 1)
  for (let b = a + 1; b < keys.length; b += 1)
    for (let c = b + 1; c < keys.length; c += 1) alliances.push([keys[a]!, keys[b]!, keys[c]!]);
const results: AllianceResult[] = alliances.map((teamKeys, i) => {
  const sum = (part: "auto" | "teleop" | "endgame") => teamKeys.reduce((t, k) => t + truth[k]![part], 0);
  return {
    matchKey: `qm${Math.floor(i / 2) + 1}`,
    order: Math.floor(i / 2) + 1,
    teamKeys,
    auto: sum("auto"),
    teleop: sum("teleop"),
    endgame: sum("endgame"),
    total: sum("auto") + sum("teleop") + sum("endgame"),
  };
});

describe("eventOpr", () => {
  it("recovers each robot's contribution and its auto / teleop / endgame split", () => {
    const opr = eventOpr(results, { decay: 1, ridge: 1e-6 });
    expect(opr[0]!.teamKey).toBe("frc1");
    const one = opr.find((row) => row.teamKey === "frc1")!;
    expect(one.total).toBeCloseTo(50, 0);
    expect(one.auto).toBeCloseTo(10, 0);
    expect(one.teleop).toBeCloseTo(30, 0);
    expect(one.endgame).toBeCloseTo(10, 0);
    expect(opr.find((row) => row.teamKey === "frc5")!.total).toBeCloseTo(14, 0);
  });

  it("weights recent matches more when a robot changes", () => {
    // frc4 breaks down in its last matches (scores nothing).
    const late = results.map((row) =>
      row.order >= 8 && row.teamKeys.includes("frc4") ? { ...row, total: row.total - 34 } : row,
    );
    const plain = eventOpr(late, { decay: 1, ridge: 1e-6 }).find((row) => row.teamKey === "frc4")!.total;
    const decayed = eventOpr(late, { decay: 0.6, ridge: 1e-6 }).find((row) => row.teamKey === "frc4")!.total;
    expect(decayed).toBeLessThan(plain);
  });

  it("rates nobody with too few matches and leaves a component out when a breakdown lacks it", () => {
    expect(eventOpr(results.slice(0, 1))).toEqual([]);
    const noAuto = results.map((row, i) => (i === 3 ? { ...row, auto: null } : row));
    const opr = eventOpr(noAuto, { decay: 1 });
    expect(opr.every((row) => row.auto === null)).toBe(true);
    expect(opr.every((row) => row.teleop !== null)).toBe(true);
  });

  it("pulls a thin early event toward the average instead of swinging wildly", () => {
    const early = eventOpr(results.slice(0, 6), { minMatches: 1 });
    for (const row of early) {
      expect(row.total).toBeGreaterThan(0);
      expect(row.total).toBeLessThan(80);
    }
  });
});

describe("seedOdds", () => {
  const standings = ["frc1", "frc2", "frc3", "frc4"].map((teamKey, i) => ({
    teamKey,
    rankingPoints: [12, 10, 9, 4][i]!,
    played: 5,
    currentRank: i + 1,
  }));
  const remaining = [
    { matchKey: "qm20", red: ["frc1", "frc4"], blue: ["frc2", "frc3"], redWinProbability: 0.9 },
    { matchKey: "qm21", red: ["frc2", "frc4"], blue: ["frc1", "frc3"], redWinProbability: null },
  ];

  it("repeats exactly for the same inputs and counts unpredicted matches", () => {
    const a = seedOdds({ standings, remaining, rules: { win: 3, tie: 1, loss: 0 }, captains: 2 });
    const b = seedOdds({ standings, remaining, rules: { win: 3, tie: 1, loss: 0 }, captains: 2 });
    expect(a).toEqual(b);
    expect(a.unpredictedMatches).toBe(1);
    expect(a.remainingMatches).toBe(2);
  });

  it("gives the leader the best odds and a team that cannot catch up none", () => {
    const odds = seedOdds({ standings, remaining, rules: { win: 3, tie: 1, loss: 0 }, captains: 2 });
    const one = odds.teams.find((row) => row.teamKey === "frc1")!;
    const four = odds.teams.find((row) => row.teamKey === "frc4")!;
    expect(one.captainChance).toBeGreaterThan(0.9);
    expect(four.captainChance).toBe(0);
    expect(one.bestLikelySeed).toBeLessThanOrEqual(one.worstLikelySeed);
    const total = odds.teams.reduce((sum, row) => sum + row.firstSeedChance, 0);
    expect(total).toBeCloseTo(1, 5);
  });
});
