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
});
