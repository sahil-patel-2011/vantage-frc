import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computePitMapPlannerView } from "./compute-pit-map-planner";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computePitMapPlannerView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computePitMapPlannerView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with a summarized layout and placed items", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM pit_map_planner_layouts") && sql.includes("SELECT footprint_width_ft")) {
        return {
          rows: [
            {
              footprintWidthFt: "10.00",
              footprintDepthFt: "10.00",
              powerCapacityAmps: "20.00",
              notes: "Corner pit, near power drop",
              updatedAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM pit_map_planner_items") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "item-1",
              name: "Robot cart",
              category: "robot_cart",
              xFt: "0.00",
              yFt: "0.00",
              widthFt: "3.00",
              depthFt: "4.00",
              powerDrawAmps: "0.00",
              notes: null,
              createdAt: "2026-02-01T00:00:00.000Z",
            },
            {
              id: "item-2",
              name: "Battery charger",
              category: "charging",
              xFt: "3.00",
              yFt: "0.00",
              widthFt: "2.00",
              depthFt: "2.00",
              powerDrawAmps: "12.00",
              notes: "Needs 20A circuit",
              createdAt: "2026-02-01T00:05:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("UNION")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computePitMapPlannerView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.layout?.footprintWidthFt).toBe(10);
    expect(view.items).toHaveLength(2);
    expect(view.summary.totalItems).toBe(2);
    expect(view.summary.usedAreaSqFt).toBe(16); // 3*4 + 2*2
    expect(view.summary.footprintAreaSqFt).toBe(100);
    expect(view.summary.totalPowerDrawAmps).toBe(12);
    expect(view.summary.powerUtilization).toBeCloseTo(0.6, 5);
    expect(view.summary.byCategory.find((c) => c.category === "charging")?.powerDrawAmps).toBe(12);
  });
});
