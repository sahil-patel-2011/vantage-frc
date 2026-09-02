import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { OFFSEASON_HORIZON_DAYS } from ".";
import { computeSpareForecastView, draftPurchaseRequest } from "./compute-spare-forecast";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
/** Mid-build — the FMEA cadence denominator is small, the horizon comes from the event or offseason. */
const MID_SEASON = new Date("2026-03-15T12:00:00.000Z");

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

const SPARE_ROW = {
  id: ITEM_ID,
  name: "Falcon 500 spare",
  category: "spare",
  subsystem: "Drivetrain",
  subsystemId: null,
  quantity: "2.00",
  unitCost: "220.00",
  minQuantity: "1.00",
};

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
      if (sql.includes("FROM inventory_items i")) return { rows: [SPARE_ROW] };
      if (sql.includes("FROM fmea_failures")) {
        return { rows: [{ subsystemName: "Drivetrain", subsystemId: null, failureCount: "6" }] };
      }
      if (sql.includes("FROM spare_forecast_purchase_requests") && sql.includes("SELECT id")) {
        return { rows: [] };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeSpareForecastView(client, {
      userId: USER,
      requestedOrg: ORG,
      seasonYear: 2026,
      asOf: MID_SEASON,
    });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.spareBinCount).toBe(1);
    expect(view.forecastLines).toHaveLength(1);
    expect(view.forecastLines[0]?.itemName).toBe("Falcon 500 spare");
    expect(view.forecastLines[0]?.failureCount).toBe(6);
    expect(view.forecastLines[0]?.forecast.rateSource).toBe("fmea");
    expect(view.forecastLines[0]?.forecast.consumptionPerDay).toBeGreaterThan(0);
    expect(view.purchaseRequests).toHaveLength(0);
  });

  it("runs the horizon to the org's active event when events_ref has a future end date", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM org_active_context")) return { rows: [{ eventName: "Regional", endDate: "2026-03-22" }] };
      if (sql.includes("FROM inventory_items i")) return { rows: [SPARE_ROW] };
      if (sql.includes("FROM fmea_failures")) return { rows: [{ subsystemName: "Drivetrain", subsystemId: null, failureCount: "6" }] };
      return { rows: [] };
    });

    const view = await computeSpareForecastView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026, asOf: MID_SEASON });
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.horizon).toEqual({ horizonDays: 7, horizonSource: "event", horizonEndsOn: "2026-03-22", eventName: "Regional" });
    expect(view.forecastLines[0]?.forecast.horizonDays).toBe(7);
  });

  it("prefers the inventory ledger rate over FMEA cadence and matches FMEA rows by subsystem id", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM inventory_items i")) return { rows: [{ ...SPARE_ROW, subsystem: "drive train", subsystemId: "sub-1" }] };
      if (sql.includes("FROM fmea_failures")) return { rows: [{ subsystemName: "Drivetrain", subsystemId: "sub-1", failureCount: "4" }] };
      if (sql.includes("FROM inventory_transactions")) return { rows: [{ itemId: ITEM_ID, usedQuantity: 9, eventCount: 3 }] };
      return { rows: [] };
    });

    const view = await computeSpareForecastView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026, asOf: MID_SEASON });
    if (view.status !== "live") throw new Error("expected live view");
    const line = view.forecastLines[0]!;
    expect(line.failureCount).toBe(4); // matched by id despite the spelling drift
    expect(line.ledgerEventCount).toBe(3);
    expect(line.observedPerDay).toBe(0.1);
    expect(line.forecast.rateSource).toBe("ledger");
    expect(line.forecast.consumptionPerDay).toBe(0.1);
  });

  it("ignores a single ledger movement and falls back to FMEA", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM inventory_items i")) return { rows: [SPARE_ROW] };
      if (sql.includes("FROM fmea_failures")) return { rows: [{ subsystemName: "Drivetrain", subsystemId: null, failureCount: "2" }] };
      if (sql.includes("FROM inventory_transactions")) return { rows: [{ itemId: ITEM_ID, usedQuantity: 20, eventCount: 1 }] };
      return { rows: [] };
    });

    const view = await computeSpareForecastView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026, asOf: MID_SEASON });
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.forecastLines[0]?.observedPerDay).toBeNull();
    expect(view.forecastLines[0]?.forecast.rateSource).toBe("fmea");
  });

  /**
   * Pinned to the REAL current date on purpose. The first version clamped a fixed 200-day
   * season window, so after mid-July every bin reported 0 days remaining and "no risk" no
   * matter how fast parts were leaving the shelf. With no registered event ahead the forecast
   * must take the explicit offseason branch and still project real consumption.
   */
  it("never reports no-risk at today's date just because the season window closed", async () => {
    const today = new Date();
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM org_active_context")) return { rows: [] };
      if (sql.includes("FROM inventory_items i")) return { rows: [{ ...SPARE_ROW, quantity: "1.00" }] };
      if (sql.includes("FROM fmea_failures")) return { rows: [{ subsystemName: "Drivetrain", subsystemId: null, failureCount: "3" }] };
      if (sql.includes("FROM inventory_transactions")) return { rows: [{ itemId: ITEM_ID, usedQuantity: 6, eventCount: 4 }] };
      return { rows: [] };
    });

    const view = await computeSpareForecastView(client, {
      userId: USER,
      requestedOrg: ORG,
      seasonYear: today.getUTCFullYear(),
      asOf: today,
    });
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.horizon.horizonSource).toBe("offseason");
    expect(view.horizon.horizonDays).toBe(OFFSEASON_HORIZON_DAYS);
    expect(view.forecastLines).toHaveLength(1);
    const forecast = view.forecastLines[0]!.forecast;
    expect(forecast.horizonDays).toBeGreaterThan(0);
    expect(forecast.consumptionPerDay).toBeGreaterThan(0);
    expect(forecast.willExhaust).toBe(true);
    expect(forecast.urgency).not.toBe("stable");
  });

  it("also keeps a FMEA-only bin at risk at today's date", async () => {
    const today = new Date();
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM inventory_items i")) return { rows: [{ ...SPARE_ROW, quantity: "0.00" }] };
      if (sql.includes("FROM fmea_failures")) return { rows: [{ subsystemName: "Drivetrain", subsystemId: null, failureCount: "12" }] };
      return { rows: [] };
    });

    const view = await computeSpareForecastView(client, {
      userId: USER,
      requestedOrg: ORG,
      seasonYear: today.getUTCFullYear(),
      asOf: today,
    });
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.forecastLines[0]?.forecast.rateSource).toBe("fmea");
    expect(view.forecastLines[0]?.forecast.willExhaust).toBe(true);
  });

  it("reports spareBinCount from real inventory even when no signal yields forecast lines", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM inventory_items i")) {
        return {
          rows: [
            {
              id: ITEM_ID,
              name: "Unused spare",
              category: "spare",
              subsystem: null,
              subsystemId: null,
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
      if (sql.includes("FROM inventory_items i")) {
        return { rows: [{ ...SPARE_ROW, quantity: "0.00" }] };
      }
      if (sql.includes("FROM fmea_failures") && sql.includes("GROUP BY")) {
        return { rows: [{ subsystemName: "Drivetrain", subsystemId: null, failureCount: "10" }] };
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
      asOf: MID_SEASON,
    });

    const requestInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO spare_forecast_purchase_requests"));
    expect(requestInsert).toBeDefined();
    const lineItemsJson = requestInsert?.params[3] as string;
    const lineItems = JSON.parse(lineItemsJson) as Array<{ itemId: string; quantityToOrder: number; rationale: string }>;
    expect(lineItems.length).toBeGreaterThan(0);
    expect(lineItems[0]?.itemId).toBe(ITEM_ID);
    expect(lineItems[0]?.quantityToOrder).toBeGreaterThan(0);
    expect(lineItems[0]?.rationale).toContain("FMEA failure(s)");
  });
});
