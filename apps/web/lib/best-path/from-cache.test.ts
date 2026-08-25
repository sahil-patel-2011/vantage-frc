import { describe, expect, it } from "vitest";
import {
  allianceTeamKeys,
  buildRemainingMatches,
  buildStandings,
  predictedOutcomeFromRatings,
  rankingPointsFromPlayedMatches,
} from "./from-cache";
import { rankingPointRulesForYear } from "./simulate";

const RULES = rankingPointRulesForYear(2025);

describe("allianceTeamKeys", () => {
  it("reads the worker's camelCase jsonb shape", () => {
    expect(allianceTeamKeys({ teamKeys: ["frc1", "frc2"], score: 88 })).toEqual(["frc1", "frc2"]);
  });

  it("reads raw TBA snake_case and bare arrays", () => {
    expect(allianceTeamKeys({ team_keys: ["frc3"] })).toEqual(["frc3"]);
    expect(allianceTeamKeys(["frc4"])).toEqual(["frc4"]);
  });

  it("returns nothing for junk", () => {
    expect(allianceTeamKeys(null)).toEqual([]);
    expect(allianceTeamKeys({ teamKeys: [1, "frc5"] })).toEqual(["frc5"]);
  });
});

describe("rankingPointsFromPlayedMatches", () => {
  it("sums official alliance ranking points per team", () => {
    const result = rankingPointsFromPlayedMatches([
      {
        matchKey: "e_qm1",
        redAlliance: { teamKeys: ["frcA", "frcB"] },
        blueAlliance: { teamKeys: ["frcC"] },
        scoreBreakdown: { red: { rp: 4 }, blue: { rp: 1 } },
      },
      {
        matchKey: "e_qm2",
        redAlliance: { teamKeys: ["frcA"] },
        blueAlliance: { teamKeys: ["frcC"] },
        scoreBreakdown: { red: { rankingPoints: 3 }, blue: { rp: 0 } },
      },
    ]);
    expect(result.byTeam).toEqual({ frcA: 7, frcB: 4, frcC: 1 });
    expect(result.matchesWithRankingPoints).toBe(2);
  });

  it("skips matches whose breakdown has no ranking points", () => {
    const result = rankingPointsFromPlayedMatches([
      {
        matchKey: "e_qm1",
        redAlliance: { teamKeys: ["frcA"] },
        blueAlliance: { teamKeys: ["frcB"] },
        scoreBreakdown: { red: { totalPoints: 90 }, blue: { totalPoints: 40 } },
      },
    ]);
    expect(result.byTeam).toEqual({});
    expect(result.matchesWithRankingPoints).toBe(0);
  });
});

describe("buildStandings", () => {
  const rows = [
    { teamKey: "frcA", rank: 1, wins: 3, losses: 0, ties: 0 },
    { teamKey: "frcB", rank: 2, wins: 2, losses: 1, ties: 0 },
  ];

  it("uses official ranking points only when every ranked team is covered", () => {
    const build = buildStandings(rows, { frcA: 12, frcB: 8 }, RULES);
    expect(build.rankingPointSource).toBe("official");
    expect(build.standings.map((team) => team.rankingPoints)).toEqual([12, 8]);
  });

  it("falls back to the record for everybody when official coverage is partial", () => {
    const build = buildStandings(rows, { frcA: 12 }, RULES);
    expect(build.rankingPointSource).toBe("record");
    expect(build.standings.map((team) => team.rankingPoints)).toEqual([9, 6]);
  });

  it("excludes — never zeroes — a team with no record at all", () => {
    const build = buildStandings(
      [...rows, { teamKey: "frcC", rank: null, wins: null, losses: null, ties: null }],
      null,
      RULES,
    );
    expect(build.excludedTeams).toEqual(["frcC"]);
    expect(build.standings).toHaveLength(2);
  });
});

describe("predictedOutcomeFromRatings", () => {
  it("calls the stronger alliance", () => {
    const result = predictedOutcomeFromRatings(["frcA", "frcB"], ["frcC"], {
      frcA: 30,
      frcB: 20,
      frcC: 40,
    });
    expect(result.predicted).toBe("red");
    expect(result.redRating).toBe(50);
    expect(result.blueRating).toBe(40);
  });

  it("makes no call when a robot has no rating", () => {
    const result = predictedOutcomeFromRatings(["frcA", "frcB"], ["frcC"], { frcA: 30, frcC: 40 });
    expect(result.predicted).toBeNull();
    expect(result.redRating).toBeNull();
  });

  it("makes no call on an exact modelled tie", () => {
    expect(predictedOutcomeFromRatings(["frcA"], ["frcC"], { frcA: 10, frcC: 10 }).predicted).toBeNull();
  });
});

describe("buildRemainingMatches", () => {
  it("orders by match number and attaches predictions", () => {
    const built = buildRemainingMatches(
      [
        {
          matchKey: "e_qm9",
          matchNumber: 9,
          redAlliance: { teamKeys: ["frcA"] },
          blueAlliance: { teamKeys: ["frcB"] },
        },
        {
          matchKey: "e_qm7",
          matchNumber: 7,
          redAlliance: { teamKeys: ["frcA"] },
          blueAlliance: { teamKeys: ["frcZ"] },
        },
      ],
      { frcA: 50, frcB: 10 },
    );
    expect(built.map((match) => match.matchKey)).toEqual(["e_qm7", "e_qm9"]);
    expect(built[0].predicted).toBeNull();
    expect(built[1].predicted).toBe("red");
  });
});
