import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { classifyMatchDelta, summarizeAlerts } from ".";
import { computeMatchDeltaWatcherView } from "./compute-match-delta-watcher";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const EVENT = "2026casj";

function mockClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number }): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

describe("classifyMatchDelta (pure)", () => {
  it("flags a winner mismatch as critical when confidence was high", () => {
    const result = classifyMatchDelta({
      predictedWinner: "red",
      actualWinner: "blue",
      pRed: 0.8,
      pBlue: 0.2,
      redTeams: ["frc254"],
      blueTeams: ["frc900"],
      pickListRanks: null,
      upsetThreshold: 0.65,
    });
    expect(result).toHaveLength(1);
    expect(result[0].alertType).toBe("winner_mismatch");
    expect(result[0].severity).toBe("critical");
  });

  it("does not flag a match where the prediction matched the result", () => {
    const result = classifyMatchDelta({
      predictedWinner: "red",
      actualWinner: "red",
      pRed: 0.9,
      pBlue: 0.1,
      redTeams: ["frc254"],
      blueTeams: ["frc900"],
      pickListRanks: null,
      upsetThreshold: 0.65,
    });
    expect(result).toHaveLength(0);
  });

  it("flags a pick-list upset when a top pick lost", () => {
    const result = classifyMatchDelta({
      predictedWinner: "red",
      actualWinner: "red",
      pRed: 0.6,
      pBlue: 0.4,
      redTeams: ["frc254"],
      blueTeams: ["frc900"],
      pickListRanks: { frc900: 2 },
      upsetThreshold: 0.65,
    });
    expect(result).toHaveLength(1);
    expect(result[0].alertType).toBe("pick_list_upset");
    expect(result[0].severity).toBe("critical");
  });
});

describe("summarizeAlerts (pure)", () => {
  it("computes accuracy rate from scored/correct counts", () => {
    const summary = summarizeAlerts([], 10, 7);
    expect(summary.accuracyRate).toBeCloseTo(0.7);
    expect(summary.totalWatchedMatches).toBe(10);
  });

  it("handles zero scored matches without dividing by zero", () => {
    const summary = summarizeAlerts([], 0, 0);
    expect(summary.accuracyRate).toBe(0);
  });
});

describe("computeMatchDeltaWatcherView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    const view = await computeMatchDeltaWatcherView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns setup_required when the org has no predictions yet", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const view = await computeMatchDeltaWatcherView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBe(ORG);
    }
  });

  it("returns a live view with alerts and summary over mock rows", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }], rowCount: 1 };
      }
      if (sql.includes("FROM match_delta_watcher_configs") && sql.includes("ORDER BY updated_at")) {
        return { rows: [{ eventKey: EVENT }], rowCount: 1 };
      }
      if (sql.includes("SELECT id, event_key")) {
        return {
          rows: [
            {
              id: "cfg-1",
              eventKey: EVENT,
              enabled: true,
              upsetThreshold: 0.65,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("SELECT DISTINCT m.event_key")) {
        return { rows: [{ eventKey: EVENT }], rowCount: 1 };
      }
      if (sql.includes("FROM match_delta_watcher_alerts")) {
        return {
          rows: [
            {
              id: "alert-1",
              matchKey: `${EVENT}_qm1`,
              eventKey: EVENT,
              compLevel: "qm",
              matchNumber: 1,
              alertType: "winner_mismatch",
              severity: "critical",
              predictedWinner: "red",
              actualWinner: "blue",
              predictedProbability: 0.8,
              summary: "Predicted red to win — blue actually won.",
              teamsInvolved: ["frc254", "frc900"],
              acknowledged: false,
              createdAt: new Date().toISOString(),
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("count(*) FILTER")) {
        return { rows: [{ totalScored: "5", correct: "3" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const view = await computeMatchDeltaWatcherView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe(ORG);
      expect(view.eventKey).toBe(EVENT);
      expect(view.alerts).toHaveLength(1);
      expect(view.alerts[0].severity).toBe("critical");
      expect(view.summary.totalWatchedMatches).toBe(5);
      expect(view.summary.accuracyRate).toBeCloseTo(0.6);
      expect(view.config?.enabled).toBe(true);
    }
  });
});
