import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { FinanceAccessError } from "../finance/finance-managers";
import { VENDOR_ORDERS_MIGRATION_MESSAGE, computeVendorCartsView, placeVendorOrder, recordActualCost } from "./vendor-orders";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const VO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

type Handler = (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number } | undefined;

function stubClient(options: { supported: boolean; manager: boolean }, handler: Handler = () => undefined) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/^\s*(SAVEPOINT|RELEASE|ROLLBACK)/i.test(sql)) return { rows: [], rowCount: 0 };
    if (sql.includes("information_schema.columns")) return options.supported ? { rows: [{}], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (sql.includes("can_manage_finances")) return { rows: [{ allowed: options.manager }], rowCount: 1 };
    if (sql.includes("ORDER BY CASE m.role")) return { rows: [{ orgId: ORG }], rowCount: 1 };
    return handler(sql, params) ?? { rows: [], rowCount: 0 };
  });
  return { client: { query } as unknown as PoolClient, query };
}

const line = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: id === A ? "NEO 550" : "SPARK MAX",
  vendor: "REV Robotics",
  vendorId: "11111111-1111-4111-8111-111111111111",
  status: "approved",
  vendorOrderId: null,
  seasonYear: 2026,
  categoryId: null,
  ...over,
});

const ran = (query: ReturnType<typeof stubClient>["query"], pattern: RegExp) => query.mock.calls.filter(([sql]) => pattern.test(String(sql)));

describe("vendor carts before the migration is applied", () => {
  it("shows a calm setup view instead of carts", async () => {
    const { client } = stubClient({ supported: false, manager: true });
    expect(await computeVendorCartsView(client, { userId: USER, requestedOrg: ORG })).toMatchObject({ status: "setup_required", reason: "migration", message: VENDOR_ORDERS_MIGRATION_MESSAGE });
  });

  it("refuses to check out until it is applied", async () => {
    const { client } = stubClient({ supported: false, manager: true });
    await expect(
      placeVendorOrder(client, { orgId: ORG, userId: USER, lines: [{ orderId: A, paidUsd: 10 }], shippingUsd: 0, taxUsd: 0, orderNumber: null, notes: null }),
    ).rejects.toThrow(VENDOR_ORDERS_MIGRATION_MESSAGE);
  });
});

describe("checking out a vendor cart", () => {
  it("is a finance manager's write", async () => {
    const { client, query } = stubClient({ supported: true, manager: false });
    await expect(
      placeVendorOrder(client, { orgId: ORG, userId: USER, lines: [{ orderId: A, paidUsd: 10 }], shippingUsd: 0, taxUsd: 0, orderNumber: null, notes: null }),
    ).rejects.toBeInstanceOf(FinanceAccessError);
    expect(ran(query, /INSERT INTO vendor_orders/)).toHaveLength(0);
  });

  it("records the order, each line's actual cost, and moves each budget line to it", async () => {
    const { client, query } = stubClient({ supported: true, manager: true }, (sql) => {
      if (sql.includes("FOR UPDATE") && sql.includes("FROM purchase_requests")) return { rows: [line(A), line(B)], rowCount: 2 };
      if (sql.includes("INSERT INTO vendor_orders")) return { rows: [{ id: VO }], rowCount: 1 };
      return undefined;
    });
    const result = await placeVendorOrder(client, {
      orgId: ORG,
      userId: USER,
      lines: [
        { orderId: A, paidUsd: 30 },
        { orderId: B, paidUsd: 10 },
      ],
      shippingUsd: 6,
      taxUsd: 2,
      orderNumber: "R-1001",
      notes: null,
    });
    expect(result).toEqual({ vendorOrderId: VO, totalUsd: 48 });
    const insert = ran(query, /INSERT INTO vendor_orders/)[0]![1] as unknown[];
    expect(insert.slice(5, 8)).toEqual([40, 6, 2]);
    const updates = ran(query, /SET status = 'ordered'/).map(([, params]) => (params as unknown[]).slice(0, 4));
    expect(updates).toEqual([
      [A, ORG, VO, 36],
      [B, ORG, VO, 12],
    ]);
    const ledger = ran(query, /INSERT INTO finance_transactions/);
    expect(ledger).toHaveLength(2);
    expect(ledger.map(([, params]) => (params as unknown[]).includes(36) || (params as unknown[]).includes(12))).toEqual([true, true]);
  });

  it("refuses a line that was already bought or isn't approved", async () => {
    const { client } = stubClient({ supported: true, manager: true }, (sql) =>
      sql.includes("FOR UPDATE") ? { rows: [line(A), line(B, { status: "ordered", vendorOrderId: VO })], rowCount: 2 } : undefined,
    );
    await expect(
      placeVendorOrder(client, { orgId: ORG, userId: USER, lines: [{ orderId: A, paidUsd: 1 }, { orderId: B, paidUsd: 1 }], shippingUsd: 0, taxUsd: 0, orderNumber: null, notes: null }),
    ).rejects.toThrow(/isn't waiting to be bought/);
  });

  it("keeps one vendor per cart", async () => {
    const { client } = stubClient({ supported: true, manager: true }, (sql) =>
      sql.includes("FOR UPDATE") ? { rows: [line(A), line(B, { vendor: "McMaster-Carr", vendorId: "22222222-2222-4222-8222-222222222222" })], rowCount: 2 } : undefined,
    );
    await expect(
      placeVendorOrder(client, { orgId: ORG, userId: USER, lines: [{ orderId: A, paidUsd: 1 }, { orderId: B, paidUsd: 1 }], shippingUsd: 0, taxUsd: 0, orderNumber: null, notes: null }),
    ).rejects.toThrow("A cart holds one vendor's requests.");
  });

  it("refuses a request listed twice", async () => {
    const { client } = stubClient({ supported: true, manager: true });
    await expect(
      placeVendorOrder(client, { orgId: ORG, userId: USER, lines: [{ orderId: A, paidUsd: 1 }, { orderId: A, paidUsd: 2 }], shippingUsd: 0, taxUsd: 0, orderNumber: null, notes: null }),
    ).rejects.toThrow("A request is listed twice.");
  });
});

describe("recording what a bought request cost", () => {
  it("sets the actual cost and the budget line together, and only once it's bought", async () => {
    let status = "ordered";
    const { client, query } = stubClient({ supported: true, manager: true }, (sql) =>
      sql.includes("FOR UPDATE") ? { rows: [{ title: "Bearings", status, seasonYear: 2026, categoryId: null }], rowCount: 1 } : undefined,
    );
    await recordActualCost(client, { orgId: ORG, userId: USER, orderId: A, actualUsd: 41.237 });
    expect(ran(query, /SET actual_cost_usd/)[0]![1]).toEqual([A, ORG, 41.24]);
    expect(ran(query, /INSERT INTO finance_transactions/)).toHaveLength(1);
    status = "approved";
    await expect(recordActualCost(client, { orgId: ORG, userId: USER, orderId: A, actualUsd: 5 })).rejects.toThrow(/once it's been bought/);
  });
});
