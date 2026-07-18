import { describe, expect, it, vi } from "vitest";
import { computeEpaTrendAlertsView } from "./compute-epa-trend-alerts";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

type QueryHandler = (sql: string, params: unknown[]) => { rows: unknown[] };

function makeClient(handler: QueryHandler) {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as import("@neondatabase/serverless").PoolClient;
}

describe("computeEpaTrendAlertsView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });

    const view = await computeEpaTrendAlertsView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.map((s) => s.id)).toEqual(["workspace", "strategy", "opponent-watchlist"]);
      expect(view.steps[0]?.href).toBe("/workspace");
      expect(view.steps.find((s) => s.id === "strategy")?.href).toBe("/competition?tab=strategy");
      expect(view.steps.every((s) => !s.href.toLowerCase().includes("demo"))).toBe(true);
      expect(view.steps.some((s) => /never DEMO/i.test(s.detail))).toBe(true);
    }
  });

  it("returns live status with an empty watchlist and no alerts when nothing is watched", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM epa_trend_alerts_watchlist")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });

    const view = await computeEpaTrendAlertsView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.watchlist).toHaveLength(0);
      expect(view.alerts).toHaveLength(0);
      expect(view.summary).toMatchObject({ watchlistCount: 0, alertCount: 0 });
    }
  });

  it("computes a rising and a falling alert from mock EPA history, honoring dismissals", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM epa_trend_alerts_watchlist")) {
        return {
          rows: [
            {
              id: "w1",
              teamKey: "frc118",
              teamNumber: 118,
              note: "Alliance-selection watch",
              createdAt: "2026-01-01T00:00:00.000Z",
              nickname: "Robonauts",
            },
            {
              id: "w2",
              teamKey: "frc148",
              teamNumber: 148,
              note: null,
              createdAt: "2026-01-02T00:00:00.000Z",
              nickname: "Robowranglers",
            },
            {
              id: "w3",
              teamKey: "frc1",
              teamNumber: 1,
              note: null,
              createdAt: "2026-01-03T00:00:00.000Z",
              nickname: "Wired",
            },
          ],
        };
      }
      if (sql.includes("FROM team_event_metrics")) {
        return {
          rows: [
            // frc118: rising sharply between two events
            { teamKey: "frc118", eventKey: "2026week1", epaTotal: 30, eventName: "Week 1", startDate: "2026-02-01" },
            { teamKey: "frc118", eventKey: "2026week2", epaTotal: 45, eventName: "Week 2", startDate: "2026-02-08" },
            // frc148: falling sharply — but the latest-event alert will be dismissed
            { teamKey: "frc148", eventKey: "2026week1", epaTotal: 40, eventName: "Week 1", startDate: "2026-02-01" },
            { teamKey: "frc148", eventKey: "2026week2", epaTotal: 25, eventName: "Week 2", startDate: "2026-02-08" },
            // frc1: only a tiny move, under threshold — no alert
            { teamKey: "frc1", eventKey: "2026week1", epaTotal: 50, eventName: "Week 1", startDate: "2026-02-01" },
            { teamKey: "frc1", eventKey: "2026week2", epaTotal: 51, eventName: "Week 2", startDate: "2026-02-08" },
          ],
        };
      }
      if (sql.includes("FROM epa_trend_alerts_dismissals")) {
        return { rows: [{ teamKey: "frc148", alertFingerprint: "frc148::2026week2" }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const view = await computeEpaTrendAlertsView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;

    expect(view.watchlist).toHaveLength(3);
    // frc148's alert was dismissed, frc1's move was under threshold — only frc118 remains.
    expect(view.alerts).toHaveLength(1);
    expect(view.alerts[0]).toMatchObject({
      teamKey: "frc118",
      direction: "up",
      previousEpa: 30,
      latestEpa: 45,
    });
    expect(view.summary).toMatchObject({
      watchlistCount: 3,
      alertCount: 1,
      risingCount: 1,
      fallingCount: 0,
    });
  });
});
