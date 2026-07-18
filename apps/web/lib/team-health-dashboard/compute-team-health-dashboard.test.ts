import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeTeamHealthDashboardView } from "./compute-team-health-dashboard";

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
    }
  });

  it("returns a live view with summary and readiness built from logged pulses", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM team_health_dashboard_pulses") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "pulse-1",
              periodLabel: "Week 1",
              periodStart: "2026-01-05",
              attendanceRate: 80,
              membersPresent: 16,
              membersTotal: 20,
              tasksCompleted: 12,
              tasksOpen: 4,
              tasksOverdue: 1,
              engagementScore: 70,
              moraleRating: 4,
              seasonYear: 2026,
              notes: null,
            },
            {
              id: "pulse-2",
              periodLabel: "Week 2",
              periodStart: "2026-01-12",
              attendanceRate: 90,
              membersPresent: 18,
              membersTotal: 20,
              tasksCompleted: 15,
              tasksOpen: 2,
              tasksOverdue: 0,
              engagementScore: 80,
              moraleRating: 5,
              seasonYear: 2026,
              notes: "Great week",
            },
          ],
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeTeamHealthDashboardView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.pulses).toHaveLength(2);
    expect(view.summary.totalPulses).toBe(2);
    expect(view.summary.totalTasksCompleted).toBe(27);
    expect(view.summary.avgAttendanceRate).toBeCloseTo(85, 0);
    expect(view.summary.latestPulse?.id).toBe("pulse-2");
    expect(view.readiness.pulsesLogged).toBe(2);
    expect(view.readiness.score).toBeGreaterThan(0);
    expect(view.seasons).toContain(2026);
  });
});
