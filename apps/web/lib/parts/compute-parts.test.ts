import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeAllocation, computePartsView, reservePart, summarizeParts } from "./compute-parts";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const ITEM = "33333333-3333-4333-8333-333333333333";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeAllocation", () => {
  it("derives available, unallocated and shortfall from on-hand, holds and BOM need", () => {
    expect(computeAllocation({ onHand: 10, reserved: 3, bomNeeded: 4 })).toEqual({
      onHandQuantity: 10,
      reservedQuantity: 3,
      availableQuantity: 7,
      bomNeededQuantity: 4,
      unallocatedQuantity: 3,
      shortfallQuantity: 0,
    });
  });

  it("never reports negative availability and surfaces the BOM shortfall instead", () => {
    const allocation = computeAllocation({ onHand: 2, reserved: 5, bomNeeded: 3 });
    expect(allocation.availableQuantity).toBe(0);
    expect(allocation.unallocatedQuantity).toBe(0);
    expect(allocation.shortfallQuantity).toBe(3);
  });

  it("treats garbage and negatives as zero rather than inventing stock", () => {
    expect(computeAllocation({ onHand: Number.NaN, reserved: -4, bomNeeded: -1 })).toEqual({
      onHandQuantity: 0,
      reservedQuantity: 0,
      availableQuantity: 0,
      bomNeededQuantity: 0,
      unallocatedQuantity: 0,
      shortfallQuantity: 0,
    });
  });
});

describe("computePartsView", () => {
  it("returns setup_required without a membership", async () => {
    const client = makeClient(() => ({ rows: [] }));
    const view = await computePartsView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
  });

  it("builds the unified stock view with reservations and BOM allocation", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, orgName: "Team", teamNumber: 254, role: "member" }] };
      // The stock query's subselects mention reservations and locations too, so match it by
      // its distinctive select list first, then the other two by their FROM clauses.
      if (sql.includes("SELECT i.id, i.name, i.kind")) {
        return {
          rows: [
            {
              id: ITEM,
              name: "NEO Vortex",
              kind: "part",
              category: "motor",
              unit: "each",
              partNumber: "REV-21-1652",
              vendor: "REV",
              subsystem: "Drivetrain",
              locationId: null,
              locationName: null,
              quantity: 6,
              reorderLevel: 4,
              unitCost: "89.99",
              archived: false,
              updatedAt: "2026-09-01T00:00:00Z",
              reserved: 3,
              bomNeeded: 4,
            },
          ],
        };
      }
      if (sql.includes("FROM inventory_locations l")) {
        return { rows: [{ id: "loc-1", name: "Shelf A", kind: "shelf", itemCount: 1, onHandQuantity: 6 }] };
      }
      if (sql.includes("FROM inventory_reservations r")) {
        return {
          rows: [
            {
              id: "res-1",
              itemId: ITEM,
              itemName: "NEO Vortex",
              quantity: 3,
              sourceKind: "spare_robot_kit",
              sourceId: null,
              status: "held",
              note: "Pack for regional",
              createdAt: "2026-09-01T00:00:00Z",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await computePartsView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live");
    const item = view.items[0]!;
    expect(item.onHandQuantity).toBe(6);
    expect(item.reservedQuantity).toBe(3);
    expect(item.availableQuantity).toBe(3);
    expect(item.unallocatedQuantity).toBe(0);
    expect(item.shortfallQuantity).toBe(1);
    // Low-stock flags against AVAILABLE stock, not on-hand: 3 available <= reorder 4.
    expect(item.low).toBe(true);
    expect(view.summary).toEqual({
      itemCount: 1,
      lowCount: 1,
      heldReservationCount: 1,
      reservedQuantity: 3,
      shortItemCount: 1,
    });
    expect(view.locations[0]?.onHandQuantity).toBe(6);
  });
});

describe("reservePart", () => {
  it("refuses to hold more than is available after existing holds", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FOR UPDATE")) return { rows: [{ quantity: 5, reserved: 4 }] };
      return { rows: [{ id: "res-9" }] };
    });
    await expect(
      reservePart(client, { orgId: ORG, userId: USER, itemId: ITEM, quantity: 2, sourceKind: "manual" }),
    ).rejects.toThrow("Only 1 available");
    const ok = await reservePart(client, { orgId: ORG, userId: USER, itemId: ITEM, quantity: 1, sourceKind: "manual" });
    expect(ok).toEqual({ reservationId: "res-9", availableQuantity: 0 });
  });
});

describe("summarizeParts", () => {
  it("counts only held reservations toward reserved quantity", () => {
    const summary = summarizeParts([], [
      { id: "a", itemId: ITEM, itemName: "x", quantity: 2, sourceKind: "manual", sourceId: null, status: "held", note: "", createdAt: "" },
      { id: "b", itemId: ITEM, itemName: "x", quantity: 9, sourceKind: "manual", sourceId: null, status: "released", note: "", createdAt: "" },
    ]);
    expect(summary.reservedQuantity).toBe(2);
    expect(summary.heldReservationCount).toBe(1);
  });
});
