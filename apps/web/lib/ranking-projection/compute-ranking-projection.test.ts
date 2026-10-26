import { describe, expect, it } from "vitest";
import { PLAYED_MATCH_RATING_CAVEAT, computeRankingProjectionView, ratingsForProjection } from "./compute-ranking-projection";
import type { PoolClient } from "@neondatabase/serverless";

function client(bySql: (sql: string) => { rows: unknown[] }): PoolClient {
  return {
    query: async (sql: string) => bySql(sql),
  } as unknown as PoolClient;
}

function routeProjection(
  sql: string,
  input: {
    teams: string[];
    epa: Record<string, number>;
    played: unknown[];
    remaining: unknown[];
  },
): { rows: unknown[] } {
  if (sql.includes("FROM memberships")) {
    return {
      rows: [{ orgId: "org-1", teamNumber: 254, eventKey: "2026gagr", eventName: "GRITS", eventYear: 2026 }],
    };
  }
  if (sql.includes("GROUP BY team_key")) {
    return {
      rows: input.teams.map((teamKey, index) => ({
        teamKey,
        rank: index + 1,
        wins: 1,
        losses: 0,
        ties: 0,
        epaTotal: input.epa[teamKey] ?? null,
      })),
    };
  }
  // Played-match ratings: the only read that asks for match_number and a result.
  if (sql.includes("match_number") && sql.includes("winning_alliance IS NOT NULL")) return { rows: input.played };
  if (sql.includes("match_number") && sql.includes("winning_alliance IS NULL")) return { rows: input.remaining };
  if (sql.includes("winning_alliance IS NULL")) return { rows: [{ count: String(input.remaining.length) }] };
  if (sql.includes("winning_alliance IS NOT NULL")) return { rows: [{ count: String(input.played.length) }] };
  if (sql.includes("team_event_metrics")) {
    return { rows: [{ rank: 1, wins: 1, losses: 0, ties: 0, epaTotal: null }] };
  }
  return { rows: [] };
}

describe("ranking projection", () => {
  it("stays setup_required without an active event", async () => {
    const view = await computeRankingProjectionView(
      client((sql) => {
        if (sql.includes("FROM memberships")) {
          return { rows: [{ orgId: "org-1", teamNumber: 254, eventKey: null, eventName: null, eventYear: null }] };
        }
        return { rows: [] };
      }),
      { userId: "u1", requestedOrg: "org-1" },
    );
    expect(view.status).toBe("setup_required");
  });

  it("returns live rank and remaining quals from cache only", async () => {
    const view = await computeRankingProjectionView(
      client((sql) => {
        if (sql.includes("FROM memberships")) {
          return { rows: [{ orgId: "org-1", teamNumber: 254, eventKey: "2026cmp", eventName: "Einstein", eventYear: 2026 }] };
        }
        if (sql.includes("team_event_metrics")) {
          return { rows: [{ rank: 4, wins: 8, losses: 2, ties: 0, epaTotal: 62.1 }] };
        }
        if (sql.includes("winning_alliance IS NULL")) return { rows: [{ count: "3" }] };
        if (sql.includes("winning_alliance IS NOT NULL")) return { rows: [{ count: "9" }] };
        return { rows: [] };
      }),
      { userId: "u1", requestedOrg: "org-1" },
    );
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.currentRank).toBe(4);
      expect(view.remainingQuals).toBe(3);
      expect(view.record).toBe("8-2-0");
    }
  });

  it("serves the what-if planner from cached standings and the unplayed schedule", async () => {
    const view = await computeRankingProjectionView(
      client((sql) => {
        if (sql.includes("FROM memberships")) {
          return { rows: [{ orgId: "org-1", teamNumber: 254, eventKey: "2025casj", eventName: "San Jose", eventYear: 2025 }] };
        }
        if (sql.includes("GROUP BY team_key")) {
          return {
            rows: [
              { teamKey: "frc254", rank: 2, wins: 3, losses: 1, ties: 0, epaTotal: 70 },
              { teamKey: "frc1678", rank: 1, wins: 4, losses: 0, ties: 0, epaTotal: 68 },
              { teamKey: "frc971", rank: 3, wins: 2, losses: 2, ties: 0, epaTotal: 55 },
              { teamKey: "frc604", rank: 4, wins: 1, losses: 3, ties: 0, epaTotal: 30 },
            ],
          };
        }
        if (sql.includes("score_breakdown")) return { rows: [] };
        if (sql.includes('AS "matchKey"')) {
          return {
            rows: [
              {
                matchKey: "2025casj_qm40",
                matchNumber: 40,
                redAlliance: { teamKeys: ["frc254", "frc604"] },
                blueAlliance: { teamKeys: ["frc1678", "frc971"] },
              },
            ],
          };
        }
        if (sql.includes("team_event_metrics")) {
          return { rows: [{ rank: 2, wins: 3, losses: 1, ties: 0, epaTotal: 70 }] };
        }
        if (sql.includes("winning_alliance IS NULL")) return { rows: [{ count: "1" }] };
        if (sql.includes("winning_alliance IS NOT NULL")) return { rows: [{ count: "4" }] };
        return { rows: [] };
      }),
      { userId: "u1", requestedOrg: "org-1" },
    );
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.whatIf).not.toBeNull();
    expect(view.whatIf?.standings).toHaveLength(4);
    // 2025 rules: three points per win, no official RP in the cache.
    expect(view.whatIf?.rules.win).toBe(3);
    expect(view.whatIf?.rankingPointSource).toBe("record");
    expect(view.whatIf?.standings.find((team) => team.teamKey === "frc254")?.rankingPoints).toBe(9);
    expect(view.whatIf?.remaining).toHaveLength(1);
    // 254 + 604 = 100 EPA vs 1678 + 971 = 123 EPA.
    expect(view.whatIf?.remaining[0].predicted).toBe("blue");
    expect(view.whatIf?.caveats.join(" ")).toMatch(/tiebreakers aren't modelled/i);
    expect(view.whatIf?.ratingSource).toBe("season");
    expect(view.whatIf?.caveats).not.toContain(PLAYED_MATCH_RATING_CAVEAT);
  });

  it("says so instead of projecting when the event has no cached ranking rows", async () => {
    const view = await computeRankingProjectionView(
      client((sql) => {
        if (sql.includes("FROM memberships")) {
          return { rows: [{ orgId: "org-1", teamNumber: 254, eventKey: "2025casj", eventName: "San Jose", eventYear: 2025 }] };
        }
        if (sql.includes("GROUP BY team_key")) return { rows: [] };
        if (sql.includes("team_event_metrics")) {
          return { rows: [{ rank: 2, wins: 3, losses: 1, ties: 0, epaTotal: 70 }] };
        }
        return { rows: [] };
      }),
      { userId: "u1", requestedOrg: "org-1" },
    );
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.whatIf).toBeNull();
    expect(view.whatIfMessage).toMatch(/sync this event/i);
  });

  it("uses one rating scale for the whole event", () => {
    const played = [
      { teamKey: "frc1", total: 80 },
      { teamKey: "frc2", total: 40 },
      { teamKey: "frc3", total: 15 },
    ];
    const season = ratingsForProjection(
      ["frc1", "frc2"],
      [
        { teamKey: "frc1", epaTotal: 10 },
        { teamKey: "frc2", epaTotal: 20 },
      ],
      played,
    );
    expect(season.source).toBe("season");
    expect(season.ratings).toEqual({ frc1: 10, frc2: 20 });

    const fromPlayed = ratingsForProjection(
      ["frc1", "frc2", "frc3"],
      [
        { teamKey: "frc1", epaTotal: null },
        { teamKey: "frc2", epaTotal: null },
      ],
      played,
    );
    expect(fromPlayed.source).toBe("played");
    expect(fromPlayed.ratings).toEqual({ frc1: 80, frc2: 40, frc3: 15 });

    const mixed = ratingsForProjection(
      ["frc1", "frc2"],
      [
        { teamKey: "frc1", epaTotal: 10 },
        { teamKey: "frc2", epaTotal: null },
      ],
      played,
    );
    expect(mixed.source).toBe("played");
    expect(mixed.ratings.frc1).toBe(80);
    expect(mixed.ratings.frc2).toBe(40);

    const none = ratingsForProjection(["frc9"], [{ teamKey: "frc9", epaTotal: null }], []);
    expect(none.source).toBe("none");
    expect(none.ratings).toEqual({});
  });

  it("rates robots from played matches when no season rating is saved, and leaves an unplayed robot unrated", async () => {
    const played = {
      matchKey: "2026gagr_qm1",
      matchNumber: 1,
      redAlliance: { teamKeys: ["frc254", "frc2", "frc3"], score: 130 },
      blueAlliance: { teamKeys: ["frc4", "frc5", "frc6"], score: 50 },
      scoreBreakdown: null,
    };
    const remaining = [
      {
        matchKey: "2026gagr_qm2",
        matchNumber: 2,
        redAlliance: { teamKeys: ["frc254", "frc2", "frc3"] },
        blueAlliance: { teamKeys: ["frc4", "frc5", "frc6"] },
      },
      {
        matchKey: "2026gagr_qm3",
        matchNumber: 3,
        redAlliance: { teamKeys: ["frc254", "frc2", "frc7"] },
        blueAlliance: { teamKeys: ["frc4", "frc5", "frc6"] },
      },
    ];
    const view = await computeRankingProjectionView(
      client((sql) =>
        routeProjection(sql, {
          teams: ["frc254", "frc2", "frc3", "frc4", "frc5", "frc6", "frc7"],
          epa: {},
          played: [played],
          remaining,
        }),
      ),
      { userId: "u1", requestedOrg: "org-1" },
    );
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.whatIf?.remaining).toHaveLength(2);
    expect(view.whatIf?.remaining[0].predicted).toBe("red");
    expect(view.whatIf?.remaining[1].predicted).toBeNull();
    expect(view.whatIf?.ratingSource).toBe("played");
    expect(view.whatIf?.caveats).toContain(PLAYED_MATCH_RATING_CAVEAT);
    expect(view.whatIf?.seedOdds?.unpredictedMatches).toBe(1);
  });

  it("keeps season ratings when every robot has one, even if a played match says otherwise", async () => {
    const view = await computeRankingProjectionView(
      client((sql) =>
        routeProjection(sql, {
          teams: ["frc254", "frc2", "frc3", "frc4", "frc5", "frc6"],
          epa: { frc254: 80, frc2: 80, frc3: 80, frc4: 10, frc5: 10, frc6: 10 },
          played: [
            {
              matchKey: "2026gagr_qm1",
              matchNumber: 1,
              redAlliance: { teamKeys: ["frc254", "frc2", "frc3"], score: 10 },
              blueAlliance: { teamKeys: ["frc4", "frc5", "frc6"], score: 200 },
              scoreBreakdown: null,
            },
          ],
          remaining: [
            {
              matchKey: "2026gagr_qm2",
              matchNumber: 2,
              redAlliance: { teamKeys: ["frc254", "frc2", "frc3"] },
              blueAlliance: { teamKeys: ["frc4", "frc5", "frc6"] },
            },
          ],
        }),
      ),
      { userId: "u1", requestedOrg: "org-1" },
    );
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.whatIf?.ratingSource).toBe("season");
    expect(view.whatIf?.remaining[0].predicted).toBe("red");
    expect(view.whatIf?.caveats).not.toContain(PLAYED_MATCH_RATING_CAVEAT);
  });

  it("does not add a season rating to played-match ratings in one alliance", async () => {
    const played = {
      matchKey: "2026gagr_qm1",
      matchNumber: 1,
      redAlliance: { teamKeys: ["frc254", "frc2", "frc3"], score: 130 },
      blueAlliance: { teamKeys: ["frc4", "frc5", "frc6"], score: 50 },
      scoreBreakdown: null,
    };
    const view = await computeRankingProjectionView(
      client((sql) =>
        routeProjection(sql, {
          teams: ["frc254", "frc2", "frc3", "frc4", "frc5", "frc6"],
          epa: { frc4: 500 },
          played: [played],
          remaining: [
            {
              matchKey: "2026gagr_qm2",
              matchNumber: 2,
              redAlliance: { teamKeys: ["frc254", "frc2", "frc3"] },
              blueAlliance: { teamKeys: ["frc4", "frc5", "frc6"] },
            },
          ],
        }),
      ),
      { userId: "u1", requestedOrg: "org-1" },
    );
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    // One robot's season rating of 500 is ignored. Everyone is rated from the 130–50 match.
    expect(view.whatIf?.ratingSource).toBe("played");
    expect(view.whatIf?.remaining[0].predicted).toBe("red");
    expect(view.whatIf?.caveats).toContain(PLAYED_MATCH_RATING_CAVEAT);
  });

  it("still plans a seed when no qualification has been played", async () => {
    const view = await computeRankingProjectionView(
      client((sql) =>
        routeProjection(sql, {
          teams: ["frc254", "frc2", "frc3", "frc4", "frc5", "frc6"],
          epa: {},
          played: [],
          remaining: [
            {
              matchKey: "2026gagr_qm1",
              matchNumber: 1,
              redAlliance: { teamKeys: ["frc254", "frc2", "frc3"] },
              blueAlliance: { teamKeys: ["frc4", "frc5", "frc6"] },
            },
          ],
        }),
      ),
      { userId: "u1", requestedOrg: "org-1" },
    );
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.whatIf).not.toBeNull();
    expect(view.whatIf?.ratingSource).toBe("none");
    expect(view.whatIf?.remaining[0].predicted).toBeNull();
    expect(view.whatIf?.caveats).not.toContain(PLAYED_MATCH_RATING_CAVEAT);
    expect(view.whatIf?.seedOdds?.unpredictedMatches).toBe(1);
  });
});
