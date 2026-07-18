import { describe, expect, it, vi } from "vitest";
import { computeOpponentWatchlistView } from "./compute-opponent-watchlist";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

type QueryHandler = (sql: string, params: unknown[]) => { rows: unknown[] };

function makeClient(handler: QueryHandler) {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as import("@neondatabase/serverless").PoolClient;
}

describe("computeOpponentWatchlistView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });

    const view = await computeOpponentWatchlistView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.map((s) => s.id)).toEqual([
        "workspace",
        "strategy",
        "epa-trend-alerts",
        "scouting",
      ]);
      expect(view.steps.every((s) => !s.href.toLowerCase().includes("demo"))).toBe(true);
    }
  });

  it("returns live status with an empty watchlist when nothing is watched", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM opponent_watchlist_entries")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });

    const view = await computeOpponentWatchlistView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.entries).toHaveLength(0);
      expect(view.alerts).toHaveLength(0);
      expect(view.summary).toMatchObject({ totalWatched: 0, epaAlerts: 0, scheduleAlerts: 0 });
    }
  });

  it("computes an EPA-rise alert and a new-match alert from mock reference rows", async () => {
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM opponent_watchlist_entries")) {
        return {
          rows: [
            {
              id: "e1",
              teamKey: "frc118",
              teamNumber: 118,
              note: "Semis threat",
              notifySchedule: true,
              notifyEpa: true,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM teams_ref")) {
        return { rows: [{ teamKey: "frc118", nickname: "Robonauts" }] };
      }
      if (sql.includes("FROM team_event_metrics")) {
        return {
          rows: [
            {
              teamKey: "frc118",
              eventKey: "2026week2",
              epaTotal: 45,
              epaAuto: 12,
              epaTeleop: 25,
              epaEndgame: 8,
              rank: 3,
            },
          ],
        };
      }
      if (sql.includes("FROM matches_ref") || sql.includes("matches_ref")) {
        return {
          rows: [
            {
              teamKey: "frc118",
              matchKey: "2026week2_qm12",
              eventKey: "2026week2",
              compLevel: "qm",
              matchNumber: 12,
              scheduledTime: "2026-02-08T18:00:00.000Z",
            },
          ],
        };
      }
      if (sql.startsWith("SELECT entry_id") || sql.includes("FROM opponent_watchlist_snapshots")) {
        return {
          rows: [
            {
              entryId: "e1",
              teamKey: "frc118",
              epaTotal: 30,
              nextMatchKey: null,
              nextMatchTime: null,
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO opponent_watchlist_snapshots")) return { rows: [] };
      throw new Error(`unexpected query: ${sql} :: ${JSON.stringify(params)}`);
    });

    const view = await computeOpponentWatchlistView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;

    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]).toMatchObject({
      teamKey: "frc118",
      nickname: "Robonauts",
      current: { epaTotal: 45 },
      nextMatch: { matchKey: "2026week2_qm12" },
    });

    expect(view.alerts).toHaveLength(2);
    const epaAlert = view.alerts.find((a) => a.type === "epa_up");
    expect(epaAlert).toMatchObject({ teamKey: "frc118", previousValue: "30", currentValue: "45" });
    const scheduleAlert = view.alerts.find((a) => a.type === "schedule_new");
    expect(scheduleAlert).toBeTruthy();

    expect(view.summary).toMatchObject({ totalWatched: 1, epaAlerts: 1, scheduleAlerts: 1 });
  });
});
