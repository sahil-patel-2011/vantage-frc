import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeVendorLeadTimesView } from "./compute-vendor-lead-times";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const VENDOR_ID = "22222222-2222-4222-8222-222222222222";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeVendorLeadTimesView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeVendorLeadTimesView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with reorder-by-date calculated from vendor lead time + safety buffer", async () => {
    const asOf = new Date("2026-07-18T00:00:00Z");
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM vendor_lead_times_vendors") && sql.includes("SELECT id, name")) {
        return {
          rows: [
            {
              id: VENDOR_ID,
              name: "AndyMark",
              leadTimeDays: "10",
              safetyBufferDays: "2",
              notes: null,
              createdAt: "2026-01-01T00:00:00Z",
            },
          ],
        };
      }
      if (sql.includes("FROM vendor_lead_times_reorders")) {
        return {
          rows: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              vendorId: VENDOR_ID,
              vendorName: "AndyMark",
              itemName: "Gearbox kit",
              quantity: "2",
              // 8 days out; lead time (10) + buffer (2) = 12 days needed, so this is overdue.
              neededBy: "2026-07-26",
              status: "open",
              notes: null,
              createdAt: "2026-07-10T00:00:00Z",
              leadTimeDays: "10",
              safetyBufferDays: "2",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await computeVendorLeadTimesView(client, { userId: USER, requestedOrg: ORG, asOf });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.vendors).toHaveLength(1);
    expect(view.vendors[0]?.name).toBe("AndyMark");
    expect(view.reorders).toHaveLength(1);
    // needed_by 2026-07-26 minus 12 days = 2026-07-14, which is before asOf (2026-07-18) -> overdue.
    expect(view.reorders[0]?.calc.orderByDate).toBe("2026-07-14");
    expect(view.reorders[0]?.calc.urgency).toBe("overdue");
    expect(view.summary.overdueCount).toBe(1);
    expect(view.summary.totalOpen).toBe(1);
  });
});
