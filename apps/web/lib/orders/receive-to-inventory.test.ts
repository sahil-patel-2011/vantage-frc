import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import {
  RECEIVE_SOURCE_KIND,
  parseInventoryItemId,
  planReceiveToInventory,
  receiveToInventory,
} from "./receive-to-inventory";

const ORG_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORDER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ITEM_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function stubClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number }) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params));
  return { client: { query } as unknown as PoolClient, query };
}

describe("planReceiveToInventory", () => {
  it("skips when inventory_item_id is missing — does not invent a catalog row", () => {
    expect(
      planReceiveToInventory({ inventoryItemId: null, quantity: 3, orderId: ORDER_ID, title: "NEO 550" }),
    ).toEqual({ kind: "skip", reason: "missing_item_id" });
    expect(
      planReceiveToInventory({ inventoryItemId: undefined, quantity: 3, orderId: ORDER_ID }),
    ).toEqual({ kind: "skip", reason: "missing_item_id" });
    expect(
      planReceiveToInventory({ inventoryItemId: "   ", quantity: 3, orderId: ORDER_ID }),
    ).toEqual({ kind: "skip", reason: "missing_item_id" });
  });

  it("skips a non-uuid item id instead of inventing stock against a guessed part", () => {
    expect(parseInventoryItemId("NEO-550")).toBeNull();
    expect(
      planReceiveToInventory({ inventoryItemId: "NEO-550", quantity: 2, orderId: ORDER_ID }),
    ).toEqual({ kind: "skip", reason: "missing_item_id" });
  });

  it("skips when quantity is missing or not a positive count — does not invent stock", () => {
    expect(
      planReceiveToInventory({ inventoryItemId: ITEM_ID, quantity: null, orderId: ORDER_ID }),
    ).toEqual({ kind: "skip", reason: "invalid_quantity" });
    expect(
      planReceiveToInventory({ inventoryItemId: ITEM_ID, quantity: 0, orderId: ORDER_ID }),
    ).toEqual({ kind: "skip", reason: "invalid_quantity" });
    expect(
      planReceiveToInventory({ inventoryItemId: ITEM_ID, quantity: -1, orderId: ORDER_ID }),
    ).toEqual({ kind: "skip", reason: "invalid_quantity" });
    expect(
      planReceiveToInventory({ inventoryItemId: ITEM_ID, quantity: Number.NaN, orderId: ORDER_ID }),
    ).toEqual({ kind: "skip", reason: "invalid_quantity" });
  });

  it("plans a received ledger row from the order's own quantity and item id", () => {
    expect(
      planReceiveToInventory({
        inventoryItemId: ITEM_ID,
        quantity: 4,
        orderId: ORDER_ID,
        title: "Falcon 500",
      }),
    ).toEqual({
      kind: "receipt",
      itemId: ITEM_ID,
      delta: 4,
      reason: "received",
      sourceKind: RECEIVE_SOURCE_KIND,
      sourceId: ORDER_ID,
      note: "Received — Falcon 500",
    });
  });
});

describe("receiveToInventory", () => {
  it("skips inventory when the caller already knows the item id is missing", async () => {
    const { client, query } = stubClient(() => ({ rows: [], rowCount: 0 }));
    const result = await receiveToInventory(client, {
      orgId: ORG_ID,
      userId: USER_ID,
      orderId: ORDER_ID,
      inventoryItemId: null,
      quantity: 2,
      title: "NEO 550",
    });
    expect(result).toEqual({ applied: false, reason: "missing_item_id" });
    expect(query).not.toHaveBeenCalled();
  });

  it("still marks-received-safe when the purchase_requests item column is absent", async () => {
    const { client, query } = stubClient(() => {
      throw Object.assign(new Error('column "inventory_item_id" does not exist'), { code: "42703" });
    });
    const result = await receiveToInventory(client, {
      orgId: ORG_ID,
      userId: USER_ID,
      orderId: ORDER_ID,
    });
    expect(result).toEqual({ applied: false, reason: "missing_item_id" });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toMatch(/inventory_item_id/);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO inventory_transactions"))).toBe(
      false,
    );
  });

  it("writes stock from purchase_requests.inventory_item_id when the caller omits it", async () => {
    const { client, query } = stubClient((sql) => {
      if (sql.includes("FROM purchase_requests")) {
        return { rows: [{ inventoryItemId: ITEM_ID, quantity: 3, title: "NEO 550" }], rowCount: 1 };
      }
      if (sql.includes("FROM inventory_transactions")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM inventory_items") && sql.includes("SELECT 1")) {
        return { rows: [{ "?column?": 1 }], rowCount: 1 };
      }
      if (sql.includes("UPDATE inventory_items")) {
        return { rows: [{ quantity: 7 }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO inventory_transactions")) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const result = await receiveToInventory(client, {
      orgId: ORG_ID,
      userId: USER_ID,
      orderId: ORDER_ID,
    });
    expect(result).toEqual({ applied: true, itemId: ITEM_ID, delta: 3 });
    expect(query.mock.calls[0]![0]).toMatch(/inventory_item_id/);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO inventory_transactions"))).toBe(true);
  });

  it("skips when the linked purchase request has no inventory_item_id", async () => {
    const { client, query } = stubClient((sql) => {
      if (sql.includes("FROM purchase_requests")) {
        return { rows: [{ inventoryItemId: null, quantity: 3, title: "NEO 550" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const result = await receiveToInventory(client, {
      orgId: ORG_ID,
      userId: USER_ID,
      orderId: ORDER_ID,
    });
    expect(result).toEqual({ applied: false, reason: "missing_item_id" });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO inventory_transactions"))).toBe(
      false,
    );
  });

  it("writes a received ledger row when the item exists", async () => {
    const { client, query } = stubClient((sql) => {
      if (sql.includes("FROM inventory_transactions")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM inventory_items") && sql.includes("SELECT 1")) {
        return { rows: [{ "?column?": 1 }], rowCount: 1 };
      }
      if (sql.includes("UPDATE inventory_items")) {
        return { rows: [{ quantity: 7 }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO inventory_transactions")) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await receiveToInventory(client, {
      orgId: ORG_ID,
      userId: USER_ID,
      orderId: ORDER_ID,
      inventoryItemId: ITEM_ID,
      quantity: 3,
      title: "NEO 550",
    });

    expect(result).toEqual({ applied: true, itemId: ITEM_ID, delta: 3 });
    const insert = query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO inventory_transactions"));
    expect(insert).toBeDefined();
    expect(insert![1]).toEqual([
      ORG_ID,
      ITEM_ID,
      3,
      "received",
      "Received — NEO 550",
      USER_ID,
      RECEIVE_SOURCE_KIND,
      ORDER_ID,
    ]);
  });

  it("does not invent stock when the linked catalog item is gone", async () => {
    const { client, query } = stubClient((sql) => {
      if (sql.includes("FROM inventory_transactions")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM inventory_items")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const result = await receiveToInventory(client, {
      orgId: ORG_ID,
      userId: USER_ID,
      orderId: ORDER_ID,
      inventoryItemId: ITEM_ID,
      quantity: 2,
    });
    expect(result).toEqual({ applied: false, reason: "missing_item" });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO inventory_transactions"))).toBe(
      false,
    );
  });

  it("replays of the same purchase request do not double-receive", async () => {
    const { client, query } = stubClient((sql) => {
      if (sql.includes("FROM inventory_transactions")) return { rows: [{ "?column?": 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const result = await receiveToInventory(client, {
      orgId: ORG_ID,
      userId: USER_ID,
      orderId: ORDER_ID,
      inventoryItemId: ITEM_ID,
      quantity: 2,
    });
    expect(result).toEqual({ applied: false, reason: "already_applied" });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO inventory_transactions"))).toBe(
      false,
    );
  });
});
