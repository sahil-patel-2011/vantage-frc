import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeSpareForecastView, draftPurchaseRequest } from "./compute-spare-forecast";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeSpareForecastView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeSpareForecastView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with forecast lines built from inventory spares x FMEA repeat rate", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM inventory_items")) {
        return {
          rows: [
            {
              id: ITEM_ID,
              name: "Falcon 500 spare",
              category: "spare",
              subsystem: "Drivetrain",
              quantity: "2.00",
              unitCost: "220.00",
              minQuantity: "1.00",
            },
          ],
        };
      }
      if (sql.includes("FROM fmea_failures")) {
        return { rows: [{ subsystemName: "Drivetrain", failureCount: "6" }] };
      }
      if (sql.includes("FROM spare_forecast_purchase_requests") && sql.includes("SELECT id")) {
        return { rows: [] };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeSpareForecastView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.spareBinCount).toBe(1);
    expect(view.forecastLines).toHaveLength(1);
    expect(view.forecastLines[0]?.itemName).toBe("Falcon 500 spare");
    expect(view.forecastLines[0]?.failureCount).toBe(6);
    expect(view.forecastLines[0]?.forecast.consumptionPerDay).toBeGreaterThan(0);
    expect(view.purchaseRequests).toHaveLength(0);
  });

  it("reports spareBinCount from real inventory even when no FMEA match yields forecast lines", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM inventory_items")) {
        return {
          rows: [
            {
              id: ITEM_ID,
              name: "Unused spare",
              category: "spare",
              subsystem: null,
              quantity: "1.00",
              unitCost: null,
              minQuantity: "0.00",
            },
          ],
        };
      }
      if (sql.includes("FROM fmea_failures")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeSpareForecastView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });
    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.spareBinCount).toBe(1);
    expect(view.forecastLines).toHaveLength(0);
  });
});

describe("draftPurchaseRequest", () => {
  it("computes and persists a purchase-request draft grounded in forecast lines that will exhaust", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM inventory_items")) {
        return {
          rows: [
            {
              id: ITEM_ID,
              name: "Falcon 500 spare",
              category: "spare",
              subsystem: "Drivetrain",
              quantity: "0.00",
              unitCost: "220.00",
              minQuantity: "1.00",
            },
          ],
        };
      }
      if (sql.includes("FROM fmea_failures") && sql.includes("GROUP BY")) {
        return { rows: [{ subsystemName: "Drivetrain", failureCount: "10" }] };
      }
      if (sql.includes("INSERT INTO ai_usage_events")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO spare_forecast_purchase_requests")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    await draftPurchaseRequest(client, {
      orgId: ORG,
      userId: USER,
      seasonYear: 2026,
      title: "Week 3 spares restock",
    });

    const requestInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO spare_forecast_purchase_requests"));
    expect(requestInsert).toBeDefined();
    const lineItemsJson = requestInsert?.params[3] as string;
    const lineItems = JSON.parse(lineItemsJson) as Array<{ itemId: string; quantityToOrder: number }>;
    expect(lineItems.length).toBeGreaterThan(0);
    expect(lineItems[0]?.itemId).toBe(ITEM_ID);
    expect(lineItems[0]?.quantityToOrder).toBeGreaterThan(0);

    const usageInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO ai_usage_events"));
    expect(usageInsert).toBeDefined();
  });
});
