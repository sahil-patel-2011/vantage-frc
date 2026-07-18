import { describe, expect, it, vi } from "vitest";
import { computeTrajectoryView } from "./compute-district-trajectory-sim";
import { mulberry32, runMonteCarloTrajectory } from ".";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

type QueryHandler = (sql: string, params: unknown[]) => { rows: unknown[] };

function makeClient(handler: QueryHandler) {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as import("@neondatabase/serverless").PoolClient;
}

describe("runMonteCarloTrajectory", () => {
  it("is deterministic given a seeded RNG and produces a monotonic probability curve", () => {
    const rand = mulberry32(42);
    const result = runMonteCarloTrajectory(
      {
        baselineEpa: 40,
        fieldEpaMean: 30,
        fieldEpaStdDev: 8,
        fieldSize: 40,
        eventsRemaining: 2,
        simRuns: 500,
      },
      null,
      rand,
    );
    expect(result.projectedPointsP10).toBeLessThanOrEqual(result.projectedPointsP50);
    expect(result.projectedPointsP50).toBeLessThanOrEqual(result.projectedPointsP90);
    expect(result.qualifyProbability).toBeGreaterThanOrEqual(0);
    expect(result.qualifyProbability).toBeLessThanOrEqual(1);
    expect(result.probabilityCurve.length).toBeGreaterThan(0);
    for (let i = 1; i < result.probabilityCurve.length; i += 1) {
      expect(result.probabilityCurve[i].points).toBeGreaterThanOrEqual(result.probabilityCurve[i - 1].points);
    }
  });

  it("a stronger baseline EPA yields a higher qualify probability against the same target", () => {
    const target = 20;
    const weak = runMonteCarloTrajectory(
      { baselineEpa: 20, fieldEpaMean: 30, fieldEpaStdDev: 8, fieldSize: 40, eventsRemaining: 3, simRuns: 800 },
      target,
      mulberry32(1),
    );
    const strong = runMonteCarloTrajectory(
      { baselineEpa: 50, fieldEpaMean: 30, fieldEpaStdDev: 8, fieldSize: 40, eventsRemaining: 3, simRuns: 800 },
      target,
      mulberry32(1),
    );
    expect(strong.qualifyProbability).toBeGreaterThan(weak.qualifyProbability);
  });

  it("returns zero events worth of points and a null default target when nothing remains", () => {
    const result = runMonteCarloTrajectory(
      { baselineEpa: 40, fieldEpaMean: 30, fieldEpaStdDev: 8, fieldSize: 40, eventsRemaining: 0, simRuns: 100 },
      null,
      mulberry32(7),
    );
    expect(result.projectedPointsP50).toBe(0);
    expect(result.pointsNeeded).toBeNull();
  });
});

describe("computeTrajectoryView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });

    const view = await computeTrajectoryView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns setup_required when no active district event is connected", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM org_active_context")) return { rows: [{ activeEventKey: null }] };
      throw new Error(`unexpected query: ${sql}`);
    });

    const view = await computeTrajectoryView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.message).toMatch(/connect an active event/i);
    }
  });

  it("returns setup_required when cached EPA sample size is too small", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM org_active_context")) return { rows: [{ activeEventKey: "2026miket" }] };
      if (sql.includes("FROM events_ref WHERE event_key")) return { rows: [{ districtKey: "fim", year: 2026 }] };
      if (sql.includes("FROM teams_ref")) return { rows: [{ teamKey: "frc254" }] };
      if (sql.includes("FROM team_year_metrics")) return { rows: [{ epaTotal: 45 }] };
      if (sql.includes("FROM events_ref er")) {
        return { rows: [{ eventKey: "2026miket", name: "Kettering", startDate: "2026-03-01", attended: true }] };
      }
      if (sql.includes("FROM team_event_metrics")) return { rows: [{ epaTotal: 30 }, { epaTotal: 32 }] };
      if (sql.includes("FROM district_trajectory_sim_projections")) return { rows: [] };
      if (sql.includes("FROM district_trajectory_sim_scenarios")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });

    const view = await computeTrajectoryView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.message).toMatch(/not enough cached epa/i);
    }
  });

  it("computes a live projection from real cached EPA + district event data", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM org_active_context")) return { rows: [{ activeEventKey: "2026miket" }] };
      if (sql.includes("FROM events_ref WHERE event_key")) return { rows: [{ districtKey: "fim", year: 2026 }] };
      if (sql.includes("FROM teams_ref")) return { rows: [{ teamKey: "frc254" }] };
      if (sql.includes("FROM team_year_metrics")) return { rows: [{ epaTotal: 45 }] };
      if (sql.includes("FROM events_ref er")) {
        return {
          rows: [
            { eventKey: "2026miket", name: "Kettering", startDate: "2026-03-01", attended: true },
            { eventKey: "2026mitry", name: "Troy", startDate: "2026-03-15", attended: false },
          ],
        };
      }
      if (sql.includes("FROM team_event_metrics")) {
        return { rows: [30, 32, 28, 40, 35, 25].map((epaTotal) => ({ epaTotal })) };
      }
      if (sql.includes("FROM district_trajectory_sim_projections")) return { rows: [] };
      if (sql.includes("FROM district_trajectory_sim_scenarios")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });

    const view = await computeTrajectoryView(client, { userId: USER, requestedOrg: ORG, simRuns: 300 });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.teamKey).toBe("frc254");
    expect(view.districtKey).toBe("fim");
    expect(view.remainingEvents).toEqual([{ eventKey: "2026mitry", name: "Troy", startDate: "2026-03-15" }]);
    expect(view.latestRun).not.toBeNull();
    expect(view.latestRun?.simRuns).toBe(300);
    expect(view.latestRun?.baselineEpa).toBe(45);
    expect(view.latestRun?.qualifyProbability).toBeGreaterThanOrEqual(0);
    expect(view.latestRun?.probabilityCurve.length).toBeGreaterThan(0);
  });
});
