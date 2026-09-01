import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeTeamHealthDashboardView } from "./compute-team-health";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeTeamHealthDashboardView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeTeamHealthDashboardView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
      expect(view.message).toMatch(/attendance and hour logs/i);
    }
    expect(view).not.toHaveProperty("moraleRating");
    expect(JSON.stringify(view)).not.toMatch(/moraleRating|avgMorale|morale_score/i);
  });

  it("returns a live empty view when attendance and hours have no logs", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships m") && sql.includes("team_number")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM memberships m") && sql.includes("JOIN users")) {
        return { rows: [{ userId: USER, name: "Ada" }] };
      }
      return { rows: [] };
    });

    const view = await computeTeamHealthDashboardView(client, {
      userId: USER,
      requestedOrg: ORG,
      seasonYear: 2026,
    });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.summary.hasLogs).toBe(false);
    expect(view.summary.engagementScore).toBeNull();
    expect(view.readiness.score).toBeNull();
    expect(view.seasons).toContain(2026);
    expect(view.summary).not.toHaveProperty("avgMoraleRating");
    expect(JSON.stringify(view)).not.toMatch(/moraleRating|avgMorale|morale_score/i);
  });

  it("builds a live engagement view from attendance entries and closed hour logs", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships m") && sql.includes("team_number")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM attendance_events") && sql.includes("SELECT id, title")) {
        return {
          rows: [{ id: "ev1", title: "Build night", kind: "build", occurredOn: "2026-01-13", creditHours: 2 }],
        };
      }
      if (sql.includes("FROM attendance_entries")) {
        return { rows: [{ eventId: "ev1", userId: USER, personName: "Ada", hours: 2 }] };
      }
      if (sql.includes("FROM hour_logs h")) {
        return {
          rows: [
            {
              id: "h1",
              userId: USER,
              name: "Ada",
              kind: "build",
              clockIn: "2026-01-13T18:00:00.000Z",
              clockOut: "2026-01-13T21:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM memberships m") && sql.includes("JOIN users")) {
        return {
          rows: [
            { userId: USER, name: "Ada" },
            { userId: "22222222-2222-4222-8222-222222222222", name: "Bo" },
          ],
        };
      }
      if (sql.includes("UNION")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeTeamHealthDashboardView(client, {
      userId: USER,
      requestedOrg: ORG,
      seasonYear: 2026,
    });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.summary.hasLogs).toBe(true);
    expect(view.summary.uniqueAttendees).toBe(1);
    expect(view.summary.totalShopHours).toBe(3);
    expect(view.summary.engagementScore).toBe(0.5);
    expect(view.readiness.tier).toBe("steady");
    expect(view.events[0]?.entryCount).toBe(1);
    expect(view.summary.checkIns.map((m) => m.name)).toEqual(["Bo"]);
    expect(view.summary).not.toHaveProperty("avgMoraleRating");
    expect(JSON.stringify(view)).not.toMatch(/moraleRating|avgMorale|morale_score/i);
    expect(JSON.stringify(view)).not.toMatch(/pulse/i);
  });
});
