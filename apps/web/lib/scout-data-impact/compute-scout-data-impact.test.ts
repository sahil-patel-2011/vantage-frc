import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeScoutDataImpactView } from "./compute-scout-data-impact";
import { pickCoverageRatio, rankContributions, summarizeByScout, totalEntriesInformingPicks } from ".";
import type { PickImpact } from "./types";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const SCOUT_A = "22222222-2222-4222-8222-222222222222";
const SCOUT_B = "33333333-3333-4333-8333-333333333333";
const EVENT = "2026txho";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeScoutDataImpactView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeScoutDataImpactView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns setup_required when the org has no logged picks", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 1234 }] };
      if (sql.includes("FROM scout_data_impact_picks p")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeScoutDataImpactView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBe(ORG);
      expect(view.steps[0]?.id).toBe("log-picks");
    }
  });

  it("returns a live view correlating logged picks against scout entries", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 1234 }] };
      if (sql.includes("SELECT DISTINCT p.event_key")) return { rows: [{ eventKey: EVENT, name: "Houston" }] };
      if (sql.includes("FROM scout_data_impact_picks p\n     LEFT JOIN teams_ref")) {
        return {
          rows: [
            {
              id: "pick-1",
              eventKey: EVENT,
              teamKey: "frc254",
              teamNumber: 254,
              allianceNumber: 1,
              pickOrder: 1,
              notes: null,
              loggedBy: USER,
              createdAt: "2026-03-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM match_scout_entries")) {
        return {
          rows: [
            { scoutUserId: SCOUT_A, scoutName: "Ada", teamKey: "frc254", matchKey: `${EVENT}_qm1` },
            { scoutUserId: SCOUT_A, scoutName: "Ada", teamKey: "frc254", matchKey: `${EVENT}_qm2` },
            { scoutUserId: SCOUT_B, scoutName: "Bo", teamKey: "frc254", matchKey: `${EVENT}_qm1` },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await computeScoutDataImpactView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.eventKey).toBe(EVENT);
    expect(view.picks).toHaveLength(1);
    expect(view.picks[0]?.totalEntries).toBe(3);
    expect(view.picks[0]?.contributions[0]?.scoutUserId).toBe(SCOUT_A);
    expect(view.picks[0]?.contributions[0]?.entryCount).toBe(2);
    expect(view.totalEntries).toBe(3);
    expect(view.coverageRatio).toBe(1);
    const summaries = view.scoutSummaries;
    expect(summaries.find((s) => s.scoutUserId === SCOUT_A)?.totalEntries).toBe(2);
    expect(summaries.find((s) => s.scoutUserId === SCOUT_B)?.picksInformed).toBe(1);
  });
});

describe("scout-data-impact pure helpers", () => {
  it("rankContributions orders by entry count, then name", () => {
    const ranked = rankContributions([
      { scoutUserId: "b", scoutName: "Bo", entryCount: 1, matchKeys: [] },
      { scoutUserId: "a", scoutName: "Ada", entryCount: 3, matchKeys: [] },
    ]);
    expect(ranked[0]?.scoutUserId).toBe("a");
  });

  it("totalEntriesInformingPicks and pickCoverageRatio aggregate across picks", () => {
    const pickImpacts: PickImpact[] = [
      {
        pick: {
          id: "p1",
          eventKey: EVENT,
          teamKey: "frc1",
          teamNumber: 1,
          allianceNumber: 1,
          pickOrder: 1,
          notes: null,
          loggedBy: USER,
          createdAt: "2026-01-01",
        },
        totalEntries: 2,
        contributions: [],
      },
      {
        pick: {
          id: "p2",
          eventKey: EVENT,
          teamKey: "frc2",
          teamNumber: 2,
          allianceNumber: 1,
          pickOrder: 2,
          notes: null,
          loggedBy: USER,
          createdAt: "2026-01-01",
        },
        totalEntries: 0,
        contributions: [],
      },
    ];
    expect(totalEntriesInformingPicks(pickImpacts)).toBe(2);
    expect(pickCoverageRatio(pickImpacts)).toBe(0.5);
    expect(pickCoverageRatio([])).toBe(0);
  });

  it("summarizeByScout rolls up contributions across picks", () => {
    const pickImpacts: PickImpact[] = [
      {
        pick: {
          id: "p1",
          eventKey: EVENT,
          teamKey: "frc1",
          teamNumber: 1,
          allianceNumber: 1,
          pickOrder: 1,
          notes: null,
          loggedBy: USER,
          createdAt: "2026-01-01",
        },
        totalEntries: 2,
        contributions: [{ scoutUserId: SCOUT_A, scoutName: "Ada", entryCount: 2, matchKeys: ["m1", "m2"] }],
      },
      {
        pick: {
          id: "p2",
          eventKey: EVENT,
          teamKey: "frc2",
          teamNumber: 2,
          allianceNumber: 1,
          pickOrder: 2,
          notes: null,
          loggedBy: USER,
          createdAt: "2026-01-01",
        },
        totalEntries: 1,
        contributions: [{ scoutUserId: SCOUT_A, scoutName: "Ada", entryCount: 1, matchKeys: ["m3"] }],
      },
    ];
    const summaries = summarizeByScout(pickImpacts);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.picksInformed).toBe(2);
    expect(summaries[0]?.totalEntries).toBe(3);
    expect(summaries[0]?.teamsScoutedThatWerePicked).toEqual(["frc1", "frc2"]);
  });
});
