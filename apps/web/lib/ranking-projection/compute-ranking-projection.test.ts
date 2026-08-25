import { describe, expect, it } from "vitest";
import { computeRankingProjectionView } from "./compute-ranking-projection";
import type { PoolClient } from "@neondatabase/serverless";

function client(bySql: (sql: string) => { rows: unknown[] }): PoolClient {
  return {
    query: async (sql: string) => bySql(sql),
  } as unknown as PoolClient;
}

describe("ranking projection", () => {
  it("stays setup_required without an active event", async () => {
    const view = await computeRankingProjectionView(
      client((sql) => {
        if (sql.includes("memberships")) return { rows: [{ orgId: "org-1", teamNumber: 254 }] };
        if (sql.includes("org_active_context")) return { rows: [{ eventKey: null }] };
        return { rows: [] };
      }),
      { userId: "u1", requestedOrg: "org-1" },
    );
    expect(view.status).toBe("setup_required");
  });

  it("returns live rank and remaining quals from cache only", async () => {
    const view = await computeRankingProjectionView(
      client((sql) => {
        if (sql.includes("memberships")) return { rows: [{ orgId: "org-1", teamNumber: 254 }] };
        if (sql.includes("org_active_context")) return { rows: [{ eventKey: "2026cmp" }] };
        if (sql.includes("events_ref")) return { rows: [{ name: "Einstein" }] };
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
        if (sql.includes("memberships")) return { rows: [{ orgId: "org-1", teamNumber: 254 }] };
        if (sql.includes("org_active_context")) return { rows: [{ eventKey: "2025casj" }] };
        if (sql.includes("events_ref")) return { rows: [{ name: "San Jose", year: 2025 }] };
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
    expect(view.whatIf?.caveats.join(" ")).toMatch(/sort-order tiebreakers/i);
  });

  it("says so instead of projecting when the event has no cached ranking rows", async () => {
    const view = await computeRankingProjectionView(
      client((sql) => {
        if (sql.includes("memberships")) return { rows: [{ orgId: "org-1", teamNumber: 254 }] };
        if (sql.includes("org_active_context")) return { rows: [{ eventKey: "2025casj" }] };
        if (sql.includes("events_ref")) return { rows: [{ name: "San Jose", year: 2025 }] };
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
    expect(view.whatIfMessage).toMatch(/sync live data/i);
  });
});
