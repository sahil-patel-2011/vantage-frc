import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { computeMatchSimView, resolveTeamCapabilities, simulateMatch } from "./compute-match-sim";
import { computeAllianceCapability, computeLever, computeMatchSimResult } from ".";
import type { TeamCapability } from "./types";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

function team(overrides: Partial<TeamCapability> = {}): TeamCapability {
  return {
    teamKey: "frc254",
    teamNumber: 254,
    epaAuto: 5,
    epaTeleop: 20,
    epaEndgame: 5,
    epaTotal: 30,
    source: "statbotics",
    hasData: true,
    ...overrides,
  };
}

describe("match-sim pure math", () => {
  it("sums alliance capability from real per-team EPA rows", () => {
    const red = computeAllianceCapability("red", [
      team({ teamKey: "frc1", teamNumber: 1, epaAuto: 5, epaTeleop: 20, epaEndgame: 5 }),
      team({ teamKey: "frc2", teamNumber: 2, epaAuto: 3, epaTeleop: 15, epaEndgame: 4 }),
    ]);
    expect(red.auto).toBe(8);
    expect(red.teleop).toBe(35);
    expect(red.endgame).toBe(9);
    expect(red.total).toBe(52);
    expect(red.dataCompleteness).toBe(1);
  });

  it("marks teams without synced EPA as no-data instead of fabricating numbers", () => {
    const alliance = computeAllianceCapability("blue", [
      team({ teamKey: "frc9", teamNumber: 9, hasData: true }),
      { teamKey: "frc10", teamNumber: 10, epaAuto: null, epaTeleop: null, epaEndgame: null, epaTotal: null, source: null, hasData: false },
    ]);
    expect(alliance.dataCompleteness).toBe(0.5);
    // the no-data team contributes zero, not a guess
    expect(alliance.auto).toBe(5);
  });

  it("picks the highest-leverage phase and weakest real contributor", () => {
    const red = computeAllianceCapability("red", [
      team({ teamKey: "frc1", teamNumber: 1, epaAuto: 2, epaTeleop: 10, epaEndgame: 2 }),
      team({ teamKey: "frc2", teamNumber: 2, epaAuto: 1, epaTeleop: 8, epaEndgame: 1 }),
    ]);
    const blue = computeAllianceCapability("blue", [
      team({ teamKey: "frc3", teamNumber: 3, epaAuto: 6, epaTeleop: 10, epaEndgame: 3 }),
      team({ teamKey: "frc4", teamNumber: 4, epaAuto: 6, epaTeleop: 9, epaEndgame: 3 }),
    ]);
    const lever = computeLever(red, blue);
    expect(lever).not.toBeNull();
    // auto gap: |3 - 12| = 9, teleop gap: |18-19| = 1, endgame gap: |3-6| = 3 -> auto is the lever
    expect(lever?.phase).toBe("auto");
    expect(lever?.alliance).toBe("red");
    expect(lever?.teamKey).toBe("frc2");
  });

  it("computeMatchSimResult produces a monotonic timeline and a favored alliance", () => {
    const red = computeAllianceCapability("red", [team()]);
    const blue = computeAllianceCapability("blue", [team({ teamKey: "frc900", teamNumber: 900, epaAuto: 1, epaTeleop: 5, epaEndgame: 1 })]);
    const result = computeMatchSimResult(red, blue);
    expect(result.timeline).toHaveLength(4);
    expect(result.timeline[3].redScore).toBe(red.total);
    expect(result.finalMargin).toBeGreaterThan(0);
    expect(result.favored).toBe("red");
  });
});

function mockClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number }): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

describe("computeMatchSimView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    const view = await computeMatchSimView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
      for (const step of view.steps) {
        expect(step.detail).not.toMatch(/TBA\/Statbotics/);
        expect(step.label).not.toMatch(/reference data/i);
      }
    }
  });

  it("returns a live view with saved runs when the org exists", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }], rowCount: 1 };
      }
      if (sql.includes("FROM match_sim_runs")) {
        return {
          rows: [
            {
              id: "run-1",
              label: "Quals 12",
              eventKey: "2026casj",
              matchKey: "2026casj_qm12",
              redTeamKeys: ["frc254"],
              blueTeamKeys: ["frc900"],
              result: computeMatchSimResult(
                computeAllianceCapability("red", [team()]),
                computeAllianceCapability("blue", [team({ teamKey: "frc900", teamNumber: 900 })]),
              ),
              createdAt: new Date().toISOString(),
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const view = await computeMatchSimView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe(ORG);
      expect(view.runs).toHaveLength(1);
      expect(view.active?.id).toBe("run-1");
    }
  });
});

describe("resolveTeamCapabilities + simulateMatch", () => {
  it("prefers event-level EPA over season EPA and flags teams with nothing synced", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM teams_ref")) {
        return {
          rows: [
            { teamKey: "frc254", teamNumber: 254 },
            { teamKey: "frc900", teamNumber: 900 },
          ],
          rowCount: 2,
        };
      }
      if (sql.includes("FROM team_event_metrics")) {
        return {
          rows: [{ teamKey: "frc254", epaAuto: 5, epaTeleop: 20, epaEndgame: 5, epaTotal: 30, source: "statbotics" }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM team_year_metrics")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    const caps = await resolveTeamCapabilities(client, ["frc254", "frc900"], "2026casj", 2026);
    expect(caps).toHaveLength(2);
    const frc254 = caps.find((c) => c.teamKey === "frc254");
    const frc900 = caps.find((c) => c.teamKey === "frc900");
    expect(frc254?.hasData).toBe(true);
    expect(frc254?.epaTotal).toBe(30);
    expect(frc900?.hasData).toBe(false);
    expect(frc900?.epaAuto).toBeNull();
  });

  it("simulateMatch produces a live summary from mock alliance rows", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM teams_ref")) {
        return {
          rows: [
            { teamKey: "frc254", teamNumber: 254 },
            { teamKey: "frc900", teamNumber: 900 },
          ],
          rowCount: 2,
        };
      }
      if (sql.includes("FROM team_event_metrics")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM team_year_metrics")) {
        return {
          rows: [
            { teamKey: "frc254", epaAuto: 5, epaTeleop: 20, epaEndgame: 5, epaTotal: 30, source: "statbotics" },
            { teamKey: "frc900", epaAuto: 2, epaTeleop: 10, epaEndgame: 2, epaTotal: 14, source: "statbotics" },
          ],
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await simulateMatch(client, {
      redTeamKeys: ["frc254"],
      blueTeamKeys: ["frc900"],
      eventKey: null,
      year: 2026,
    });
    expect(result.red.total).toBe(30);
    expect(result.blue.total).toBe(14);
    expect(result.finalMargin).toBe(16);
    expect(result.favored).toBe("red");
    expect(result.lever).not.toBeNull();
  });
});
