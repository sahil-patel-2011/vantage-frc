import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeBomCostRollupView } from "./compute-bom-cost-rollup";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeBomCostRollupView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeBomCostRollupView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with cost totals rolled up against budget", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM bom_cost_rollup_line_items") && sql.includes("ORDER BY created_at DESC")) {
        return {
          rows: [
            {
              id: "item-1",
              partName: "6061 Aluminum Plate",
              subsystem: "Drivetrain",
              category: "raw_material",
              quantity: 2,
              unitCostUsd: "45.00",
              source: "manual",
              cadReference: null,
              seasonYear: 2026,
              notes: null,
              createdAt: "2026-02-01T00:00:00.000Z",
            },
            {
              id: "item-2",
              partName: "NEO Motor",
              subsystem: "Intake",
              category: "purchased",
              quantity: 3,
              unitCostUsd: "50.00",
              source: "cad_import",
              cadReference: "onshape:doc-123",
              seasonYear: 2026,
              notes: null,
              createdAt: "2026-02-02T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM bom_cost_rollup_budgets") && sql.includes("WHERE org_id")) {
        return { rows: [{ budgetUsd: "200.00" }] };
      }
      if (sql.includes("UNION SELECT DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeBomCostRollupView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.items).toHaveLength(2);
    // 2*45 + 3*50 = 240
    expect(view.summary.totalCostUsd).toBe(240);
    expect(view.summary.budgetUsd).toBe(200);
    expect(view.summary.remainingUsd).toBe(-40);
    expect(view.summary.status).toBe("over");
    expect(view.summary.bySubsystem.length).toBe(2);
    expect(view.summary.byCategory.length).toBe(2);
  });
});
