import { describe, expect, it } from "vitest";
import {
  DEFAULT_BEST_PATH_LIMITS,
  bankedRankingPoints,
  bestPath,
  describeBestPath,
  describeFlip,
  outcomeFor,
  projectedRankOf,
  rankingPointRulesForYear,
  seedProjection,
} from "./simulate";
import type { RemainingMatch, StandingTeam } from "./types";

const RULES_2025 = rankingPointRulesForYear(2025);

/**
 * Hand-computed fixture (win 3 / tie 1 / loss 0).
 *
 * standings   A 9 (rank 1)  B 6 (rank 2)  C 6 (rank 3)  D 3 (rank 4)
 * Q4  red A,B  vs blue C,D  predicted red
 * Q5  red A,C  vs blue B,D  predicted blue
 *
 * baseline: A 9+3+0=12, B 6+3+3=12, C 6+0+0=6, D 3+0+3=6
 *           -> A 1, B 2, C 3, D 4 (ties broken by current rank)
 */
const STANDINGS: StandingTeam[] = [
  { teamKey: "frcA", rankingPoints: 9, played: 3, currentRank: 1 },
  { teamKey: "frcB", rankingPoints: 6, played: 3, currentRank: 2 },
  { teamKey: "frcC", rankingPoints: 6, played: 3, currentRank: 3 },
  { teamKey: "frcD", rankingPoints: 3, played: 3, currentRank: 4 },
];

const REMAINING: RemainingMatch[] = [
  { matchKey: "e_qm4", matchNumber: 4, red: ["frcA", "frcB"], blue: ["frcC", "frcD"], predicted: "red" },
  { matchKey: "e_qm5", matchNumber: 5, red: ["frcA", "frcC"], blue: ["frcB", "frcD"], predicted: "blue" },
];

describe("rankingPointRulesForYear", () => {
  it("uses the pre-2025 two-point win for older seasons", () => {
    const rules = rankingPointRulesForYear(2024);
    expect(rules.win).toBe(2);
    expect(rules.tie).toBe(1);
    expect(rules.confirmed).toBe(true);
  });

  it("uses the 2025 three-point win", () => {
    expect(rankingPointRulesForYear(2025).win).toBe(3);
    expect(rankingPointRulesForYear(2025).confirmed).toBe(true);
  });

  it("flags an unconfirmed table for a season it has not encoded", () => {
    const future = rankingPointRulesForYear(2031);
    expect(future.win).toBe(3);
    expect(future.confirmed).toBe(false);
    expect(future.label).toMatch(/confirm/i);
    const unknown = rankingPointRulesForYear(null);
    expect(unknown.confirmed).toBe(false);
    expect(unknown.year).toBeNull();
  });
});

describe("bankedRankingPoints", () => {
  it("prefers the official ranking points from the cached breakdown", () => {
    const banked = bankedRankingPoints({
      officialRankingPoints: 17,
      wins: 4,
      losses: 1,
      ties: 0,
      rules: RULES_2025,
    });
    expect(banked).toEqual({ rankingPoints: 17, source: "official", played: 5 });
  });

  it("falls back to the win/tie record when no official total exists", () => {
    const banked = bankedRankingPoints({ wins: 4, losses: 1, ties: 1, rules: RULES_2025 });
    expect(banked?.rankingPoints).toBe(4 * 3 + 1);
    expect(banked?.source).toBe("record");
    expect(banked?.played).toBe(6);
  });

  it("returns null rather than inventing a total with no record at all", () => {
    expect(bankedRankingPoints({ wins: null, ties: null, rules: RULES_2025 })).toBeNull();
  });
});

describe("seedProjection", () => {
  it("projects the hand-computed baseline", () => {
    const projection = seedProjection(STANDINGS, REMAINING, {}, RULES_2025);
    expect(projection.byTeam.frcA.projectedRankingPoints).toBe(12);
    expect(projection.byTeam.frcB.projectedRankingPoints).toBe(12);
    expect(projection.byTeam.frcC.projectedRankingPoints).toBe(6);
    expect(projection.byTeam.frcD.projectedRankingPoints).toBe(6);
    expect(projection.rows.map((row) => row.teamKey)).toEqual(["frcA", "frcB", "frcC", "frcD"]);
    expect(projection.decidedMatches).toBe(2);
    expect(projection.undecidedMatches).toBe(0);
  });

  it("breaks projected ties on the current official rank, then team key", () => {
    const tied = seedProjection(
      [
        { teamKey: "frcZ", rankingPoints: 6, played: 3, currentRank: 9 },
        { teamKey: "frcY", rankingPoints: 6, played: 3, currentRank: 2 },
        { teamKey: "frcX", rankingPoints: 6, played: 3, currentRank: null },
        { teamKey: "frcW", rankingPoints: 6, played: 3, currentRank: null },
      ],
      [],
      {},
      RULES_2025,
    );
    expect(tied.rows.map((row) => row.teamKey)).toEqual(["frcY", "frcZ", "frcW", "frcX"]);
  });

  it("reports rank delta against the current official rank", () => {
    const projection = seedProjection(STANDINGS, REMAINING, { e_qm4: "blue", e_qm5: "red" }, RULES_2025);
    // A 9+0+3=12, B 6+0+0=6, C 6+3+3=12, D 3+3+0=6 -> A 1, C 2, B 3, D 4
    expect(projectedRankOf(projection, "frcC")).toBe(2);
    expect(projection.byTeam.frcC.rankDelta).toBe(1);
    expect(projection.byTeam.frcB.rankDelta).toBe(-1);
    expect(projection.byTeam.frcC.gained).toBe(6);
  });

  it("counts unpredicted matches as undecided instead of assuming a winner", () => {
    const projection = seedProjection(
      STANDINGS,
      [{ ...REMAINING[0], predicted: null }, REMAINING[1]],
      {},
      RULES_2025,
    );
    expect(projection.undecidedMatches).toBe(1);
    expect(projection.decidedMatches).toBe(1);
    expect(projection.byTeam.frcA.undecidedMatches).toBe(1);
    // Nobody banks RP for the undecided match.
    expect(projection.byTeam.frcA.projectedRankingPoints).toBe(9);
  });

  it("never seeds a scheduled team that has no standings row", () => {
    const projection = seedProjection(
      STANDINGS,
      [
        {
          matchKey: "e_qm6",
          matchNumber: 6,
          red: ["frcA", "frcGhost"],
          blue: ["frcC", "frcD"],
          predicted: "red",
        },
      ],
      {},
      RULES_2025,
    );
    expect(projection.unknownTeams).toEqual(["frcGhost"]);
    expect(projection.byTeam.frcGhost).toBeUndefined();
    expect(projection.rows).toHaveLength(4);
  });

  it("is idempotent: an override equal to the prediction changes nothing", () => {
    const base = seedProjection(STANDINGS, REMAINING, {}, RULES_2025);
    const same = seedProjection(STANDINGS, REMAINING, { e_qm4: "red", e_qm5: "blue" }, RULES_2025);
    expect(same.rows).toEqual(base.rows);
  });

  it("is idempotent: re-applying the same override set yields the same projection", () => {
    const overrides = { e_qm4: "blue", e_qm5: "red" } as const;
    const first = seedProjection(STANDINGS, REMAINING, { ...overrides }, RULES_2025);
    const second = seedProjection(STANDINGS, REMAINING, { ...overrides }, RULES_2025);
    expect(second.rows).toEqual(first.rows);
    expect(outcomeFor(REMAINING[0], overrides)).toBe("blue");
    expect(outcomeFor(REMAINING[0], {})).toBe("red");
  });

  it("honours the season's ranking-point table", () => {
    const older = seedProjection(STANDINGS, REMAINING, {}, rankingPointRulesForYear(2024));
    // A 9+2+0 = 11 under the two-point win.
    expect(older.byTeam.frcA.projectedRankingPoints).toBe(11);
  });
});

describe("bestPath", () => {
  it("finds the minimal two-flip path that lifts our seed", () => {
    const result = bestPath({
      teamKey: "frcC",
      standings: STANDINGS,
      remainingMatches: REMAINING,
      rules: RULES_2025,
    });
    expect(result.baselineRank).toBe(3);
    expect(result.bestRank).toBe(2);
    expect(result.flips).toHaveLength(2);
    expect(result.flips.map((flip) => flip.matchKey)).toEqual(["e_qm4", "e_qm5"]);
    expect(result.flips.map((flip) => flip.outcome)).toEqual(["blue", "red"]);
    expect(result.capped).toBe(false);
    // Applying exactly the returned flips reproduces the promised seed.
    const applied = seedProjection(
      STANDINGS,
      REMAINING,
      Object.fromEntries(result.flips.map((flip) => [flip.matchKey, flip.outcome])),
      RULES_2025,
    );
    expect(projectedRankOf(applied, "frcC")).toBe(result.bestRank);
  });

  it("prefers a single flip when one is enough", () => {
    const result = bestPath({
      teamKey: "frcB",
      standings: STANDINGS,
      remainingMatches: [REMAINING[1]],
      rules: RULES_2025,
    });
    // Only Q5 remains: baseline B 6+3=9, A 9, C 6, D 6 -> A 1, B 2.
    expect(result.baselineRank).toBe(2);
    // Flipping Q5 to red costs B its win, so nothing improves and no flips are returned.
    expect(result.flips).toHaveLength(0);
    expect(result.bestRank).toBe(2);
  });

  it("returns no flips when the seed is already provably the best reachable", () => {
    const result = bestPath({
      teamKey: "frcA",
      standings: STANDINGS,
      remainingMatches: REMAINING,
      rules: RULES_2025,
    });
    expect(result.baselineRank).toBe(1);
    expect(result.flips).toEqual([]);
    expect(result.cappedReason).toMatch(/best reachable seed/i);
    expect(result.capped).toBe(false);
  });

  it("says when the candidate list was capped", () => {
    const many: RemainingMatch[] = Array.from({ length: 8 }, (_, index) => ({
      matchKey: "e_qm" + (10 + index),
      matchNumber: 10 + index,
      red: ["frcA", "frcB"],
      blue: ["frcC", "frcD"],
      predicted: index % 2 === 0 ? "red" : "blue",
    }));
    const result = bestPath({
      teamKey: "frcC",
      standings: STANDINGS,
      remainingMatches: many,
      rules: RULES_2025,
      limits: { maxCandidates: 3 },
    });
    expect(result.candidateMatches).toBe(3);
    expect(result.capped).toBe(true);
    expect(result.cappedReason).toMatch(/narrowed/i);
  });

  it("says when the evaluation budget stopped the search", () => {
    const many: RemainingMatch[] = Array.from({ length: 10 }, (_, index) => ({
      matchKey: "e_qm" + (20 + index),
      matchNumber: 20 + index,
      red: ["frcA", "frcC"],
      blue: ["frcB", "frcD"],
      predicted: "red",
    }));
    const result = bestPath({
      teamKey: "frcD",
      standings: STANDINGS,
      remainingMatches: many,
      rules: RULES_2025,
      limits: { maxEvaluations: 2, maxCandidates: 10 },
    });
    expect(result.evaluations).toBeLessThanOrEqual(2);
    expect(result.capped).toBe(true);
    expect(result.cappedReason).toMatch(/budget/i);
  });

  it("is deterministic across repeated runs", () => {
    const run = () =>
      bestPath({ teamKey: "frcC", standings: STANDINGS, remainingMatches: REMAINING, rules: RULES_2025 });
    expect(run()).toEqual(run());
  });

  it("respects overrides the user already set and never re-flips them", () => {
    const result = bestPath({
      teamKey: "frcC",
      standings: STANDINGS,
      remainingMatches: REMAINING,
      overrides: { e_qm4: "red" },
      rules: RULES_2025,
    });
    expect(result.flips.every((flip) => flip.matchKey !== "e_qm4")).toBe(true);
    expect(result.consideredMatches).toBe(1);
  });

  it("stays honest when the team has no standings row", () => {
    const result = bestPath({
      teamKey: "frcNope",
      standings: STANDINGS,
      remainingMatches: REMAINING,
      rules: RULES_2025,
    });
    expect(result.baselineRank).toBeNull();
    expect(result.flips).toEqual([]);
    expect(result.cappedReason).toMatch(/no standings row/i);
  });

  it("ships a deterministic default limit set", () => {
    expect(DEFAULT_BEST_PATH_LIMITS.maxDepth).toBeGreaterThan(0);
    expect(DEFAULT_BEST_PATH_LIMITS.maxEvaluations).toBeGreaterThan(0);
  });
});

describe("describeFlip", () => {
  it("phrases our own match as beat/lose", () => {
    expect(
      describeFlip(
        {
          matchKey: "e_qm78",
          matchNumber: 78,
          red: ["frcC", "frcX"],
          blue: ["frc254", "frcY"],
          outcome: "red",
          predicted: "blue",
          ourSide: "red",
        },
        "frcC",
      ),
    ).toBe("Beat 254, Y in Q78");
    expect(
      describeFlip(
        {
          matchKey: "e_qm78",
          matchNumber: 78,
          red: ["frcC"],
          blue: ["frc254"],
          outcome: "blue",
          predicted: "red",
          ourSide: "red",
        },
        "frcC",
      ),
    ).toBe("Lose to 254 in Q78");
  });

  it("phrases a rival match as a loss for the alliance that must drop it", () => {
    expect(
      describeFlip(
        {
          matchKey: "e_qm81",
          matchNumber: 81,
          red: ["frc1678"],
          blue: ["frc118"],
          outcome: "blue",
          predicted: "red",
          ourSide: null,
        },
        "frcC",
      ),
    ).toBe("1678 loses Q81 to 118");
  });

  it("names both alliances when a rival match has to tie", () => {
    expect(
      describeFlip(
        {
          matchKey: "e_qm81",
          matchNumber: 81,
          red: ["frc1678", "frc971"],
          blue: ["frc118"],
          outcome: "tie",
          predicted: "red",
          ourSide: null,
        },
        "frcC",
      ),
    ).toBe("Q81 ends in a tie (1678, 971 vs 118)");
  });

  it("phrases a tie in our own match from our side", () => {
    expect(
      describeFlip(
        {
          matchKey: "e_qm78",
          matchNumber: 78,
          red: ["frcC"],
          blue: ["frc254"],
          outcome: "tie",
          predicted: "blue",
          ourSide: "red",
        },
        "frcC",
      ),
    ).toBe("Tie 254 in Q78");
  });

  it("summarises the plan without inventing a seed", () => {
    const result = bestPath({
      teamKey: "frcC",
      standings: STANDINGS,
      remainingMatches: REMAINING,
      rules: RULES_2025,
    });
    expect(describeBestPath(result)).toBe("2 outcomes move you from seed 3 to seed 2.");
  });
});
