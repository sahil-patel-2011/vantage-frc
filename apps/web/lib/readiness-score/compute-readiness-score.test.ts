import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeReadinessScoreView } from "./compute-readiness-score";

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

  it("reads the roster, weight, power and gate state from the build tools that own them", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM robot_subsystems")) {
        return {
          rows: [
            { id: SUBSYSTEM_ID, name: "Drivetrain", notes: null, updatedAt: "2026-02-01T00:00:00.000Z" },
            {
              id: "55555555-5555-4555-8555-555555555555",
              name: "Intake",
              notes: null,
              updatedAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM weight_components")) {
        // 32.5 attributed to Drivetrain, 9.25 to Intake, plus a 12 lb unlabelled
        // line (bumpers) that belongs in the total but not against a subsystem.
        return {
          rows: [
            { subsystem: "Drivetrain", total: "32.5" },
            { subsystem: "Intake", total: "9.25" },
            { subsystem: "", total: "12" },
          ],
        };
      }
      if (sql.includes("FROM weight_settings")) return { rows: [{ limitLbs: "118" }] };
      if (sql.includes("FROM power_loads")) {
        return {
          rows: [
            { subsystem: "Drivetrain", total: "40" },
            { subsystem: "Intake", total: "12" },
          ],
        };
      }
      if (sql.includes("FROM subsystem_signoff_records")) {
        return {
          rows: [
            { name: "Drivetrain", gate: "wiring", decision: "approved" },
            { name: "Drivetrain", gate: "programming", decision: "approved" },
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
    expect(view.subsystems.map((s) => s.name)).toEqual(["Drivetrain", "Intake"]);

    const drivetrain = view.subsystems[0];
    expect(drivetrain.weightLbs).toBe(32.5);
    expect(drivetrain.powerDrawAmps).toBe(40);
    // Both gates signed off -> verified wiring, deployed & tested code, health 1.0.
    expect(drivetrain.wiringStatus).toBe("verified");
    expect(drivetrain.codeVersionStatus).toBe("deployed_tested");
    expect(drivetrain.healthScore).toBe(1);

    // Intake has no sign-off record at all, so it starts un-reviewed rather than
    // being credited with anything nobody has checked.
    expect(view.subsystems[1].wiringStatus).toBe("not_started");
    expect(view.subsystems[1].codeVersionStatus).toBe("stale");

    // The team's own configured limit wins over the FRC default.
    expect(view.index.weightBudgetLbs).toBe(118);
    // Total covers the unlabelled bumper line as well as the two attributed ones.
    expect(view.index.weightUsedLbs).toBe(53.75);
    expect(view.index.powerUsedAmps).toBe(52);

    expect(view.checklistItems).toHaveLength(1);
    expect(view.openFmeaFailures).toHaveLength(1);
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

    // Every column names the tool that owns it, so the page can send a team there
    // instead of offering a second place to type the same number.
    expect(view.sources.map((s) => s.id)).toContain("weight-budget");
    expect(view.sources.map((s) => s.id)).toContain("subsystem-signoff");
  });

  it("does not credit headroom it cannot account for when the budgets are empty", async () => {
    // Regression: the old island scored weight/power headroom 1.0 whenever no rows
    // existed, so the index went UP the less a team had recorded. Weight recorded
    // against a real limit must move the headroom off a perfect score.
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM robot_subsystems")) {
        return { rows: [{ id: SUBSYSTEM_ID, name: "Drivetrain", notes: null, updatedAt: "2026-02-01T00:00:00.000Z" }] };
      }
      if (sql.includes("FROM weight_components")) return { rows: [{ subsystem: "Drivetrain", total: "110" }] };
      if (sql.includes("FROM weight_settings")) return { rows: [{ limitLbs: "118" }] };
      return { rows: [] };
    });

    const view = await computeReadinessScoreView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });
    if (view.status !== "live") throw new Error("expected live view");

    expect(view.index.weightUsedLbs).toBe(110);
    expect(view.index.weightBudgetLbs).toBe(118);
    // 110 of 118 lbs leaves under 7% headroom, and the fix list has to say so.
    expect(view.index.components.weightHeadroom).toBeLessThan(0.1);
    expect(view.index.fixList.some((item) => item.category === "weight")).toBe(true);
  });
});
