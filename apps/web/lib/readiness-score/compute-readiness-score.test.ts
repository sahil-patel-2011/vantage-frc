import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeReadinessScoreView, saveSubsystem } from "./compute-readiness-score";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const SUBSYSTEM_ID = "22222222-2222-4222-8222-222222222222";
const CHECKLIST_ID = "33333333-3333-4333-8333-333333333333";
const FMEA_ID = "44444444-4444-4444-8444-444444444444";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeReadinessScoreView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeReadinessScoreView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with a grounded readiness index and ordered fix list", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM readiness_score_subsystems") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: SUBSYSTEM_ID,
              name: "Drivetrain",
              weightLbs: "40.00",
              powerDrawAmps: "60.00",
              wiringStatus: "verified",
              codeVersionStatus: "deployed_tested",
              healthScore: "1.000",
              notes: null,
              updatedAt: "2026-02-01T00:00:00.000Z",
            },
            {
              id: "55555555-5555-4555-8555-555555555555",
              name: "Intake",
              weightLbs: "10.00",
              powerDrawAmps: "20.00",
              wiringStatus: "not_started",
              codeVersionStatus: "stale",
              healthScore: "0.000",
              notes: null,
              updatedAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM readiness_score_checklist_items")) {
        return {
          rows: [
            {
              id: CHECKLIST_ID,
              subsystemName: "Intake",
              label: "Confirm intake limit switch wiring",
              isComplete: false,
              sequence: 1,
              createdAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM fmea_failures")) {
        return {
          rows: [
            {
              id: FMEA_ID,
              title: "Intake roller stall",
              subsystemName: "Intake",
              severity: 8,
              occurrence: 5,
              detection: 4,
              status: "open",
            },
          ],
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeReadinessScoreView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.subsystems).toHaveLength(2);
    expect(view.checklistItems).toHaveLength(1);
    expect(view.openFmeaFailures).toHaveLength(1);
    // Drivetrain fully verified/deployed + Intake not started -> mid-range subsystem/code health.
    expect(view.index.components.subsystemHealth).toBeCloseTo(0.5, 5);
    expect(view.index.components.codeReadiness).toBeCloseTo(0.5, 5);
    expect(view.index.openFmeaCount).toBe(1);
    expect(view.index.highSeverityFmeaCount).toBe(1);
    // Fix list is severity-ordered (highest urgency first) and includes the open FMEA.
    const severities = view.index.fixList.map((item) => item.severity);
    expect(severities).toEqual([...severities].sort((a, b) => b - a));
    expect(view.index.fixList.some((item) => item.category === "fmea")).toBe(true);
    expect(view.index.score).toBeGreaterThan(0);
    expect(view.index.score).toBeLessThan(1);
  });
});

describe("saveSubsystem", () => {
  it("computes a deterministic health score from wiring + code status and upserts it", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if ((sql.includes("INSERT INTO ai_usage_events") || sql.includes("INSERT INTO ai_render_attempts"))) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO readiness_score_subsystems")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    await saveSubsystem(client, {
      orgId: ORG,
      userId: USER,
      seasonYear: 2026,
      name: "Climber",
      weightLbs: 8,
      powerDrawAmps: 15,
      wiringStatus: "verified",
      codeVersionStatus: "deployed_tested",
      notes: null,
    });

    const subsystemInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO readiness_score_subsystems"));
    expect(subsystemInsert).toBeDefined();
    // verified wiring (1.0) * 0.5 + deployed_tested code (1.0) * 0.5 = 1.0
    expect(subsystemInsert?.params).toContain(1);

    const usageInsert = inserted.find((entry) => (entry.sql.includes("INSERT INTO ai_usage_events") || entry.sql.includes("INSERT INTO ai_render_attempts")));
    expect(usageInsert).toBeDefined();
  });
});
