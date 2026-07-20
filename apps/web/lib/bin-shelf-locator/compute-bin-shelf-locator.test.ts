import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { computeBinShelfLocatorView } from "./compute-bin-shelf-locator";
import { binShelfLocationKindLabel, decodeLocatorPayload, encodeLocatorPayload } from ".";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";

function mockClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number }): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

describe("locator payload helpers (pure)", () => {
  it("encodes and round-trips an item payload", () => {
    const payload = encodeLocatorPayload("item", ITEM);
    expect(payload).toBe(`vantage:bin-shelf-locator:item:${ITEM}`);
    expect(decodeLocatorPayload(payload)).toEqual({ kind: "item", id: ITEM });
  });

  it("rejects payloads that don't match the scheme", () => {
    expect(decodeLocatorPayload("not-a-payload")).toBeNull();
    expect(decodeLocatorPayload("vantage:bin-shelf-locator:widget:not-a-uuid")).toBeNull();
  });

  it("labels location kinds for display", () => {
    expect(binShelfLocationKindLabel("bin")).toBe("Bin");
    expect(binShelfLocationKindLabel("unknown")).toBe("Other");
  });
});

describe("computeBinShelfLocatorView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    const view = await computeBinShelfLocatorView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns setup_required when the org has no inventory items and no locations", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("JOIN organizations")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }], rowCount: 1 };
      }
      if (sql.includes("count(*)::text AS count")) {
        return { rows: [{ count: "0" }], rowCount: 1 };
      }
      if (sql.includes("FROM bin_shelf_locator_locations")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    const view = await computeBinShelfLocatorView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBe(ORG);
    }
  });

  it("returns a live view with locations, placements, and moves from real rows", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("JOIN organizations")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }], rowCount: 1 };
      }
      if (sql.includes("count(*)::text AS count")) {
        return { rows: [{ count: "3" }], rowCount: 1 };
      }
      if (sql.includes("FROM bin_shelf_locator_locations")) {
        return {
          rows: [
            {
              id: "loc-1",
              code: "A1",
              kind: "bin",
              zone: "Electronics",
              photoUrl: null,
              notes: "",
              archived: false,
              itemCount: "1",
              createdAt: "2026-07-01T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM inventory_items")) {
        return {
          rows: [{ id: ITEM, name: "NEO Motor", category: "motor", partNumber: "REV-21-1650", quantity: "6" }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM bin_shelf_locator_item_locations")) {
        return {
          rows: [
            {
              id: "il-1",
              itemId: ITEM,
              itemName: "NEO Motor",
              itemCategory: "motor",
              locationId: "loc-1",
              locationCode: "A1",
              locationKind: "bin",
              quantity: "4",
              lastSeenAt: "2026-07-10T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM bin_shelf_locator_moves")) {
        return {
          rows: [
            {
              id: "mv-1",
              itemId: ITEM,
              itemName: "NEO Motor",
              fromLocationId: null,
              fromLocationCode: null,
              toLocationId: "loc-1",
              toLocationCode: "A1",
              quantity: "4",
              method: "putaway",
              note: "",
              movedBy: USER,
              createdAt: "2026-07-10T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const view = await computeBinShelfLocatorView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe(ORG);
      expect(view.locations).toHaveLength(1);
      expect(view.locations[0].code).toBe("A1");
      expect(view.placements).toHaveLength(1);
      expect(view.placements[0].quantity).toBe(4);
      expect(view.recentMoves).toHaveLength(1);
      expect(view.items).toHaveLength(1);
      expect(view.items[0].name).toBe("NEO Motor");
    }
  });
});
