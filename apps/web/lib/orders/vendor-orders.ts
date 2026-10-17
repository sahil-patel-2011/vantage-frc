// Vendor carts and actual spend (0738) — under the caller's withRls transaction.
//
// Ships ahead of its migration: until 0738 is applied the carts view answers a
// calm "not set up yet" and every other order path behaves exactly as before.

export { orderSpendExpression, vendorOrdersSupported } from "./actual-spend-support";

import type { PoolClient } from "@neondatabase/serverless";
import { assertFinanceManager, canManageFinances } from "../finance/finance-managers";
import { recordMoney } from "../finance/ledger";
import { vendorOrdersSupported } from "./actual-spend-support";
import { progressOrder } from "./compute-orders";
import {
  checkoutBreakdown,
  groupIntoCarts,
  vendorKey,
  type CartSourceOrder,
  type CheckoutLine,
  type PlacedVendorOrder,
  type VendorCartsView,
} from "./vendor-carts-model";

export type { VendorCartsView };
import { currentSeasonYear } from "@vantage/game-year";


export const VENDOR_ORDERS_MIGRATION_MESSAGE =
  "Buying by vendor isn't switched on for this team yet. An admin applies database update 0738, then carts show up here.";

export const MAX_CART_LINES = 100;

async function resolveOrg(client: PoolClient, userId: string, requestedOrg: string | null): Promise<string | null> {
  const result = await client.query<{ orgId: string }>(
    `SELECT m.org_id AS "orgId"
       FROM memberships m
       JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = $1::uuid
        AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
      LIMIT 1`,
    [userId, requestedOrg],
  );
  return result.rows[0]?.orgId ?? null;
}

function num(value: string | number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function computeVendorCartsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number },
): Promise<VendorCartsView> {
  const orgId = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!orgId) return { status: "setup_required", reason: "no_team", message: "Choose your team to see orders.", orgId: null };
  if (!(await vendorOrdersSupported(client))) {
    return { status: "setup_required", reason: "migration", message: VENDOR_ORDERS_MIGRATION_MESSAGE, orgId };
  }
  const seasonYear = input.seasonYear ?? currentSeasonYear();

  const open = await client.query<CartSourceOrder & { totalCostUsd: string }>(
    `SELECT p.id, p.title, p.vendor, p.vendor_id AS "vendorId", p.quantity, p.total_cost_usd::text AS "totalCostUsd",
            p.cost_source::text AS "costSource", p.status::text AS status, p.vendor_order_id AS "vendorOrderId",
            p.item_url AS "itemUrl", COALESCE(NULLIF(u.name, ''), u.email) AS "requestedByName", p.needed_by::text AS "neededBy"
       FROM purchase_requests p
       LEFT JOIN users u ON u.id = p.requested_by
      WHERE p.org_id = $1::uuid AND p.season_year = $2::int AND p.status = 'approved' AND p.vendor_order_id IS NULL
      ORDER BY p.needed_by NULLS LAST, p.created_at
      LIMIT 500`,
    [orgId, seasonYear],
  );
  const carts = groupIntoCarts(open.rows.map((row) => ({ ...row, quantity: num(row.quantity), totalCostUsd: num(row.totalCostUsd) })));

  const placedRows = await client.query<{
    id: string;
    vendorName: string;
    orderNumber: string | null;
    subtotalUsd: string;
    shippingUsd: string;
    taxUsd: string;
    totalUsd: string;
    placedAt: string;
    placedByName: string | null;
  }>(
    `SELECT v.id, v.vendor_name AS "vendorName", v.order_number AS "orderNumber",
            v.subtotal_usd::text AS "subtotalUsd", v.shipping_usd::text AS "shippingUsd", v.tax_usd::text AS "taxUsd",
            v.total_usd::text AS "totalUsd", v.placed_at::text AS "placedAt", COALESCE(NULLIF(u.name, ''), u.email) AS "placedByName"
       FROM vendor_orders v
       LEFT JOIN users u ON u.id = v.placed_by
      WHERE v.org_id = $1::uuid AND v.season_year = $2::int
      ORDER BY v.placed_at DESC
      LIMIT 20`,
    [orgId, seasonYear],
  );
  const ids = placedRows.rows.map((row) => row.id);
  const lineRows = ids.length
    ? await client.query<{ vendorOrderId: string; orderId: string; title: string; status: string; expectedUsd: string; actualUsd: string | null }>(
        `SELECT p.vendor_order_id AS "vendorOrderId", p.id AS "orderId", p.title, p.status::text AS status,
                p.total_cost_usd::text AS "expectedUsd", p.actual_cost_usd::text AS "actualUsd"
           FROM purchase_requests p
          WHERE p.org_id = $1::uuid AND p.vendor_order_id = ANY($2::uuid[])
          ORDER BY p.title`,
        [orgId, ids],
      )
    : { rows: [] };
  const placed: PlacedVendorOrder[] = placedRows.rows.map((row) => ({
    id: row.id,
    vendorName: row.vendorName,
    orderNumber: row.orderNumber,
    subtotalUsd: num(row.subtotalUsd),
    shippingUsd: num(row.shippingUsd),
    taxUsd: num(row.taxUsd),
    totalUsd: num(row.totalUsd),
    placedAt: row.placedAt,
    placedByName: row.placedByName,
    lines: lineRows.rows
      .filter((line) => line.vendorOrderId === row.id)
      .map((line) => ({ orderId: line.orderId, title: line.title, status: line.status, expectedUsd: num(line.expectedUsd), actualUsd: line.actualUsd == null ? null : num(line.actualUsd) })),
  }));

  return {
    status: "live",
    orgId,
    seasonYear,
    canPlace: await canManageFinances(client, orgId),
    carts,
    placed,
    computedAt: new Date().toISOString(),
  };
}

type LockedLine = {
  id: string;
  title: string;
  vendor: string;
  vendorId: string | null;
  status: string;
  vendorOrderId: string | null;
  seasonYear: number;
  categoryId: string | null;
};

/**
 * Check out one vendor's cart: one vendor_orders row, every line marked ordered with what it
 * actually cost (price plus its share of shipping and tax), and each line's ledger mirror moved
 * to that figure, all in the caller's transaction.
 */
export async function placeVendorOrder(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    lines: CheckoutLine[];
    shippingUsd: number;
    taxUsd: number;
    orderNumber: string | null;
    notes: string | null;
  },
): Promise<{ vendorOrderId: string; totalUsd: number }> {
  await assertFinanceManager(client, input.orgId);
  if (!(await vendorOrdersSupported(client))) throw new Error(VENDOR_ORDERS_MIGRATION_MESSAGE);
  const ids = [...new Set(input.lines.map((line) => line.orderId))];
  if (!ids.length) throw new Error("Pick at least one request to buy.");
  if (ids.length !== input.lines.length) throw new Error("A request is listed twice.");
  if (ids.length > MAX_CART_LINES) throw new Error(`Buy up to ${MAX_CART_LINES} requests in one order.`);

  const locked = await client.query<LockedLine>(
    `SELECT id, title, vendor, vendor_id AS "vendorId", status::text AS status, vendor_order_id AS "vendorOrderId",
            season_year AS "seasonYear", category_id AS "categoryId"
       FROM purchase_requests
      WHERE org_id = $1::uuid AND id = ANY($2::uuid[])
      FOR UPDATE`,
    [input.orgId, ids],
  );
  if (locked.rows.length !== ids.length) throw new Error("A request in this cart is gone. Refresh and try again.");
  const stale = locked.rows.find((row) => row.status !== "approved" || row.vendorOrderId);
  if (stale) throw new Error(`“${stale.title}” isn't waiting to be bought any more. Refresh and try again.`);
  const keys = new Set(locked.rows.map((row) => vendorKey(row.vendorId, row.vendor)));
  if (keys.size !== 1) throw new Error("A cart holds one vendor's requests.");
  const first = locked.rows[0]!;

  const breakdown = checkoutBreakdown(input.lines, input.shippingUsd, input.taxUsd);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO vendor_orders (org_id, season_year, vendor_id, vendor_name, order_number, subtotal_usd, shipping_usd, tax_usd, notes, placed_by)
     VALUES ($1::uuid, $2::int, $3::uuid, $4, $5, $6, $7, $8, $9, $10::uuid)
     RETURNING id`,
    [input.orgId, first.seasonYear, first.vendorId, (first.vendor.trim() || "No vendor").slice(0, 200), input.orderNumber, breakdown.subtotalUsd, breakdown.shippingUsd, breakdown.taxUsd, input.notes, input.userId],
  );
  const vendorOrderId = inserted.rows[0]!.id;

  for (const row of locked.rows) {
    const actual = breakdown.actualByOrder.get(row.id) ?? 0;
    await client.query(
      `UPDATE purchase_requests
          SET status = 'ordered'::purchase_request_status, ordered_at = now(), vendor_order_id = $3::uuid,
              actual_cost_usd = $4, updated_at = now()
        WHERE id = $1::uuid AND org_id = $2::uuid AND status = 'approved'`,
      [row.id, input.orgId, vendorOrderId, actual],
    );
    // The budget counts what was paid from the moment it's bought: the approval's mirror row
    // (same org/source/source_id) is upserted to the actual figure.
    await recordMoney(client, {
      orgId: input.orgId,
      source: "purchase_request",
      sourceId: row.id,
      direction: "out",
      amountUsd: actual,
      seasonYear: row.seasonYear,
      categoryId: row.categoryId,
      label: `Order — ${row.title}`,
      createdBy: input.userId,
    });
  }
  return { vendorOrderId, totalUsd: breakdown.totalUsd };
}

/** Everything still on its way from one placed order arrived: receive each line (and stock it). */
export async function receiveVendorOrder(
  client: PoolClient,
  input: { orgId: string; userId: string; vendorOrderId: string },
): Promise<number> {
  await assertFinanceManager(client, input.orgId);
  if (!(await vendorOrdersSupported(client))) throw new Error(VENDOR_ORDERS_MIGRATION_MESSAGE);
  const lines = await client.query<{ id: string }>(
    `SELECT id FROM purchase_requests WHERE org_id = $1::uuid AND vendor_order_id = $2::uuid AND status = 'ordered' ORDER BY title`,
    [input.orgId, input.vendorOrderId],
  );
  for (const line of lines.rows) {
    await progressOrder(client, { orgId: input.orgId, userId: input.userId, orderId: line.id, status: "received" });
  }
  return lines.rows.length;
}

/**
 * Record what an already-bought request actually cost (one a buyer ordered on their own, priced
 * later from the receipt). Moves its ledger mirror to the same figure.
 */
export async function recordActualCost(
  client: PoolClient,
  input: { orgId: string; userId: string; orderId: string; actualUsd: number },
): Promise<void> {
  await assertFinanceManager(client, input.orgId);
  if (!(await vendorOrdersSupported(client))) throw new Error(VENDOR_ORDERS_MIGRATION_MESSAGE);
  const result = await client.query<{ title: string; status: string; seasonYear: number; categoryId: string | null }>(
    `SELECT title, status::text AS status, season_year AS "seasonYear", category_id AS "categoryId"
       FROM purchase_requests WHERE id = $1::uuid AND org_id = $2::uuid FOR UPDATE`,
    [input.orderId, input.orgId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Purchase request not found");
  if (row.status !== "ordered" && row.status !== "received" && row.status !== "reimbursed") {
    throw new Error("Record what it cost once it's been bought.");
  }
  const actual = Math.round(input.actualUsd * 100) / 100;
  await client.query(
    `UPDATE purchase_requests SET actual_cost_usd = $3, updated_at = now() WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.orderId, input.orgId, actual],
  );
  await recordMoney(client, {
    orgId: input.orgId,
    source: "purchase_request",
    sourceId: input.orderId,
    direction: "out",
    amountUsd: actual,
    seasonYear: row.seasonYear,
    categoryId: row.categoryId,
    label: `Order — ${row.title}`,
    createdBy: input.userId,
  });
}
