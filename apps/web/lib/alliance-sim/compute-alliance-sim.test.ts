import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { computeAllianceSimResult } from ".";
import { computeAllianceSimView } from "./compute-alliance-sim";
import type { AllianceSimRobot } from "./types";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

function robot(overrides: Partial<AllianceSimRobot> = {}): AllianceSimRobot {
  return {
    id: "robot-1",
    teamNumber: 254,
    teamName: null,
    capableRoles: [],
    roleStrengths: {},
    ...overrides,
  };
}

function mockClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number }): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

describe("alliance-sim pure math", () => {
  it("assigns roles by highest strength first and reports zero result for no robots", () => {
    expect(computeAllianceSimResult([])).toEqual({
      assignments: [],
      conflicts: [],
      coverageRatio: 0,
      essentialCoverage: 0,
      winProbability: 0,
      totalStrength: 0,
      maxPossibleStrength: 0,
    });
  });

  it("detects a physical role conflict when two robots want the single climb slot", () => {
    const robots = [
      robot({ id: "r1", teamNumber: 1, capableRoles: ["primary_climb"], roleStrengths: { primary_climb: 5 } }),
      robot({ id: "r2", teamNumber: 2, capableRoles: ["primary_climb"], roleStrengths: { primary_climb: 4 } }),
    ];
    const result = computeAllianceSimResult(robots);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].robotId).toBe("r1");
    expect(result.assignments[0].role).toBe("primary_climb");
    const conflict = result.conflicts.find((c) => c.role === "primary_climb");
    expect(conflict).toBeDefined();
    expect(conflict?.unassigned).toEqual([{ robotId: "r2", teamNumber: 2 }]);
  });

  it("produces full coverage and no conflicts when each robot fills a distinct essential role", () => {
    const robots = [
      robot({ id: "r1", teamNumber: 1, capableRoles: ["primary_climb"], roleStrengths: { primary_climb: 5 } }),
      robot({
        id: "r2",
        teamNumber: 2,
        capableRoles: ["primary_score_high"],
        roleStrengths: { primary_score_high: 5 },
      }),
      robot({ id: "r3", teamNumber: 3, capableRoles: ["auto_mobility"], roleStrengths: { auto_mobility: 5 } }),
    ];
    const result = computeAllianceSimResult(robots);
    expect(result.assignments).toHaveLength(3);
    expect(result.conflicts).toHaveLength(0);
    expect(result.coverageRatio).toBe(1);
    expect(result.essentialCoverage).toBe(1);
    expect(result.winProbability).toBeCloseTo(1, 5);
  });
});

describe("computeAllianceSimView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    const view = await computeAllianceSimView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with the selected scenario's robots and computed result", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }], rowCount: 1 };
      }
      if (sql.includes("FROM alliance_sim_scenarios")) {
        return {
          rows: [
            {
              id: "scenario-1",
              name: "Semifinal alliance A",
              eventName: "2026 Silicon Valley",
              seasonYear: 2026,
              notes: null,
              createdAt: new Date().toISOString(),
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM alliance_sim_robots")) {
        return {
          rows: [
            {
              id: "robot-1",
              teamNumber: 254,
              teamName: "The Cheesy Poofs",
              capableRoles: ["primary_climb", "auto_mobility"],
              roleStrengths: { primary_climb: 5 },
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const view = await computeAllianceSimView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe(ORG);
      expect(view.scenarios).toHaveLength(1);
      expect(view.selectedScenarioId).toBe("scenario-1");
      expect(view.robots).toHaveLength(1);
      expect(view.robots[0].teamNumber).toBe(254);
      expect(view.result.assignments.some((a) => a.role === "primary_climb")).toBe(true);
    }
  });
});
