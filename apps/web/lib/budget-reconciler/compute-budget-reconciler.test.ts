import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeBudgetReconcilerView, runReconciliation } from "./compute-budget-reconciler";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeBudgetReconcilerView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeBudgetReconcilerView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with subsystem mass/current readings and a trim proposal when over budget", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM weight_components") && sql.includes("GROUP BY")) {
        return {
          rows: [
            { subsystem: "Drivetrain", massLbs: "60.00" },
            { subsystem: "Intake", massLbs: "20.00" },
          ],
        };
      }
      if (sql.includes("FROM power_loads") && sql.includes("GROUP BY")) {
        return {
          rows: [
            { subsystem: "Drivetrain", currentAmps: "40.00" },
            { subsystem: "Intake", currentAmps: "20.00" },
          ],
        };
      }
      if (sql.includes("FROM weight_settings")) {
        return { rows: [{ limitLbs: "70.00" }] };
      }
      if (sql.includes("SUM(breaker_amps)")) {
        return { rows: [{ breakerAmps: "50.00" }] };
      }
      if (sql.includes("UNION SELECT DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      if (sql.includes("FROM budget_reconciler_reports")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const view = await computeBudgetReconcilerView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.subsystems).toHaveLength(2);
    expect(view.mass.totalLbs).toBe(80);
    expect(view.mass.status).toBe("over");
    expect(view.current.totalAmps).toBe(60);
    expect(view.current.status).toBe("over");
    expect(view.trimProposal?.subsystem).toBe("Drivetrain");
  });
});

describe("runReconciliation", () => {
  it("computes and persists a deterministic drift snapshot with a trim proposal", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM weight_components") && sql.includes("GROUP BY")) {
        return { rows: [{ subsystem: "Drivetrain", massLbs: "60.00" }, { subsystem: "Intake", massLbs: "20.00" }] };
      }
      if (sql.includes("FROM power_loads") && sql.includes("GROUP BY")) {
        return { rows: [{ subsystem: "Drivetrain", currentAmps: "40.00" }] };
      }
      if (sql.includes("FROM weight_settings")) {
        return { rows: [{ limitLbs: "70.00" }] };
      }
      if (sql.includes("SUM(breaker_amps)")) {
        return { rows: [{ breakerAmps: "60.00" }] };
      }
      if ((sql.includes("INSERT INTO ai_usage_events") || sql.includes("INSERT INTO ai_render_attempts"))) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO budget_reconciler_reports")) {
        inserted.push({ sql, params });
        return { rows: [{ id: "report-1", createdAt: "2026-02-01T00:00:00.000Z" }] };
      }
      return { rows: [] };
    });

    const report = await runReconciliation(client, { orgId: ORG, userId: USER, seasonYear: 2026 });

    expect(report.massTotalLbs).toBe(80);
    expect(report.massStatus).toBe("over");
    expect(report.trimSubsystem).toBe("Drivetrain");
    expect(report.trimAmountLbs).toBeGreaterThan(0);
    expect(report.confidence).toBeGreaterThan(0);

    const reportInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO budget_reconciler_reports"));
    expect(reportInsert).toBeDefined();
    expect(reportInsert?.params).toContain("Drivetrain");

    const usageInsert = inserted.find((entry) => (entry.sql.includes("INSERT INTO ai_usage_events") || entry.sql.includes("INSERT INTO ai_render_attempts")));
    expect(usageInsert).toBeDefined();
  });
});
