import { describe, expect, it } from "vitest";
import { parseTeamNumber, rankPairwise } from "./rank";

describe("pairwise Bradley-Terry ranking", () => {
  it("returns no ranks when nobody has compared teams", () => {
    expect(rankPairwise([])).toEqual([]);
  });

  it("ranks a transitive chain A > B > C from real taps only", () => {
    const ranks = rankPairwise([
      { winnerTeamNumber: 254, loserTeamNumber: 1678 },
      { winnerTeamNumber: 254, loserTeamNumber: 1678 },
      { winnerTeamNumber: 1678, loserTeamNumber: 118 },
      { winnerTeamNumber: 1678, loserTeamNumber: 118 },
    ]);
    expect(ranks.map((row) => row.teamNumber)).toEqual([254, 1678, 118]);
    expect(ranks[0]?.wins).toBe(2);
    expect(ranks[2]?.wins).toBe(0);
    expect(ranks[0]!.strength).toBeGreaterThan(ranks[1]!.strength);
    expect(ranks[1]!.strength).toBeGreaterThan(ranks[2]!.strength);
  });

  it("ignores same-team and invalid numbers instead of inventing a field", () => {
    expect(
      rankPairwise([
        { winnerTeamNumber: 33, loserTeamNumber: 33 },
        { winnerTeamNumber: 0, loserTeamNumber: 1 },
      ]),
    ).toEqual([]);
  });

  it("parses FRC team numbers", () => {
    expect(parseTeamNumber("254")).toBe(254);
    expect(parseTeamNumber("0")).toBeNull();
    expect(parseTeamNumber("abc")).toBeNull();
  });
});
