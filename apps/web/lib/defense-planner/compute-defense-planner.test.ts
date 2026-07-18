import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeDefensePlannerView, logMatchup } from "./compute-defense-planner";
import type { RobotProfile } from "./types";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeDefensePlannerView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeDefensePlannerView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view built from scouted matchup rows, with a computed recommendation", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM defense_planner_robot_profiles") && sql.includes("SELECT season_year")) {
        return {
          rows: [
            {
              seasonYear: 2026,
              massLbs: "120.00",
              drivetrainType: "swerve",
              topSpeedFps: "16.00",
              notes: "Comp-ready swerve",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM defense_planner_matchups") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "matchup-1",
              seasonYear: 2026,
              opponentTeamNumber: 118,
              opponentTeamName: "Robonauts",
              eventKey: "2026txho",
              opponentMassLbs: "110.00",
              opponentDrivetrainType: "west_coast",
              opponentCycleTimeSec: "7.00",
              opponentCyclePath: "loading zone -> mid field -> speaker",
              opponentAvgPointsPerCycle: "4.00",
              notes: "Fast cycler, weak defense",
              recommendation: "play_defense",
              assignedDefender: "us",
              confidence: "0.71",
              rationale: "Team 118 runs fast, high-value cycles; we outweigh and out-mobilize them.",
              computedAt: "2026-02-01T00:00:00.000Z",
              createdAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("UNION")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeDefensePlannerView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.robotProfile?.drivetrain).toBe("swerve");
    expect(view.matchups).toHaveLength(1);
    expect(view.matchups[0]?.recommendation).toBe("play_defense");
    expect(view.matchups[0]?.opponentTeamNumber).toBe(118);
  });
});

describe("logMatchup", () => {
  it("computes and persists a deterministic recommendation grounded in the scouted inputs", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("INSERT INTO ai_usage_events")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO defense_planner_matchups")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    const robotProfile: RobotProfile = {
      seasonYear: 2026,
      massLbs: 125,
      drivetrain: "swerve",
      topSpeedFps: 17,
      notes: "",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    await logMatchup(client, {
      orgId: ORG,
      userId: USER,
      seasonYear: 2026,
      opponentTeamNumber: 254,
      opponentTeamName: "The Cheesy Poofs",
      eventKey: null,
      opponentMassLbs: 100,
      opponentDrivetrain: "tank",
      opponentCycleTimeSec: 6,
      opponentCyclePath: "human player -> amp -> speaker",
      opponentAvgPointsPerCycle: 5,
      notes: "",
      robotProfile,
    });

    const matchupInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO defense_planner_matchups"));
    expect(matchupInsert).toBeDefined();
    // High denial value (50 pts/min) and a strong mass/mobility edge -> play defense, assign us.
    expect(matchupInsert?.params).toContain("play_defense");
    expect(matchupInsert?.params).toContain("us");

    const usageInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO ai_usage_events"));
    expect(usageInsert).toBeDefined();
  });
});
