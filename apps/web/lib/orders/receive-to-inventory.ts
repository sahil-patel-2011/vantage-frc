// When a purchase request is marked received, append an inventory_transactions
// receipt for it — never invent stock: the quantity is the order's own quantity, and an
// order with no quantity skips the ledger and leaves the receive itself alone.
//
// An order linked to a catalog item lands on that item. An order with no link (a pasted
// vendor link, a one-off part) gets its own inventory item, named and priced from the
// order, and is linked to it — deliveries used to skip inventory entirely unless someone
// had picked an existing item when ordering.

import type { PoolClient } from "@neondatabase/serverless";
import { withSavepointOrThrow } from "@vantage/db";
import { adjustStock } from "../parts/store";

export const RECEIVE_SOURCE_KIND = "purchase_request";

const ITEM_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReceiveToInventorySkipReason = "missing_item_id" | "invalid_quantity" | "missing_item" | "already_applied";

export type ReceiveToInventoryPlan =
  | { kind: "skip"; reason: Extract<ReceiveToInventorySkipReason, "missing_item_id" | "invalid_quantity"> }
  | {
      kind: "receipt";
      itemId: string;
      delta: number;
      reason: "received";
      sourceKind: typeof RECEIVE_SOURCE_KIND;
      sourceId: string;
      note: string;
    };

export type ReceiveToInventoryInput = {
  orgId: string;
  userId: string;
  orderId: string;
  inventoryItemId?: string | null;
  quantity?: number | null;
  title?: string | null;
};

export type ReceiveToInventoryResult =
  | { applied: false; reason: ReceiveToInventorySkipReason }
  | { applied: true; itemId: string; delta: number };

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseInventoryItemId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return ITEM_ID.test(trimmed) ? trimmed : null;
}

export function planReceiveToInventory(input: {
  inventoryItemId: string | null | undefined;
  quantity: number | null | undefined;
  orderId: string;
  title?: string | null;
}): ReceiveToInventoryPlan {
  const itemId = parseInventoryItemId(input.inventoryItemId);
  if (!itemId) return { kind: "skip", reason: "missing_item_id" };

  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { kind: "skip", reason: "invalid_quantity" };
  }

  const title = typeof input.title === "string" ? input.title.trim() : "";
  return {
    kind: "receipt",
    itemId,
    delta: round2(quantity),
    reason: "received",
    sourceKind: RECEIVE_SOURCE_KIND,
    sourceId: input.orderId,
    note: title ? `Received — ${title}`.slice(0, 500) : "Purchase received",
  };
}

function isMissingItemColumn(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return code === "42703" || /inventory_item_id|undefined_column/i.test(message);
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

type LinkedOrder = { inventoryItemId: string | null; quantity: number | null; title: string | null; vendor: string | null; unitCost: number | null };

async function loadLinkedOrder(client: PoolClient, input: { orgId: string; orderId: string }): Promise<LinkedOrder & { columnMissing: boolean }> {
  const empty = { inventoryItemId: null, quantity: null, title: null, vendor: null, unitCost: null };
  try {
    const loaded = await client.query<{
      inventoryItemId: string | null;
      quantity: string | number | null;
      title: string | null;
      vendor: string | null;
      unitCost: string | number | null;
    }>(
      `SELECT inventory_item_id AS "inventoryItemId", quantity, title, vendor, unit_cost_usd AS "unitCost"
       FROM purchase_requests
       WHERE id = $1::uuid AND org_id = $2::uuid`,
      [input.orderId, input.orgId],
    );
    const row = loaded.rows[0];
    if (!row) return { ...empty, columnMissing: false };
    const quantity = row.quantity == null ? null : Number(row.quantity);
    const unitCost = row.unitCost == null ? null : Number(row.unitCost);
    return {
      inventoryItemId: row.inventoryItemId,
      quantity: Number.isFinite(quantity) ? quantity : null,
      title: row.title,
      vendor: row.vendor,
      unitCost: Number.isFinite(unitCost) ? unitCost : null,
      columnMissing: false,
    };
  } catch (error) {
    if (isMissingItemColumn(error)) return { ...empty, columnMissing: true };
    throw error;
  }
}

/**
 * The inventory item an unlinked order becomes: its own name, vendor and unit price, starting at
 * zero (the receipt below adds the delivered quantity), linked back to the order.
 */
async function createItemForOrder(
  client: PoolClient,
  input: { orgId: string; userId: string; orderId: string; order: LinkedOrder },
): Promise<string | null> {
  const name = input.order.title?.trim();
  if (!name) return null;
  const created = await client.query<{ id: string }>(
    `INSERT INTO inventory_items (org_id, name, vendor, unit_cost, notes, created_by)
     VALUES ($1::uuid, $2::text, $3::text, $4::numeric, $5::text, $6::uuid)
     RETURNING id`,
    [input.orgId, name.slice(0, 200), input.order.vendor?.trim() || null, input.order.unitCost, "Added from a received order", input.userId],
  );
  const itemId = created.rows[0]?.id ?? null;
  if (itemId) {
    await client.query(
      `UPDATE purchase_requests SET inventory_item_id = $3::uuid WHERE id = $1::uuid AND org_id = $2::uuid AND inventory_item_id IS NULL`,
      [input.orderId, input.orgId, itemId],
    );
  }
  return itemId;
}

/**
 * Write a received ledger row when the purchase request names a real catalog item.
 * Callers mark the request received regardless of the skip reasons here.
 */
export async function receiveToInventory(
  client: PoolClient,
  input: ReceiveToInventoryInput,
): Promise<ReceiveToInventoryResult> {
  let inventoryItemId = input.inventoryItemId;
  let quantity = input.quantity;
  let title = input.title;

  const itemIdKnown = input.inventoryItemId !== undefined;
  const quantityKnown = input.quantity !== undefined;
  const loaded = await loadLinkedOrder(client, { orgId: input.orgId, orderId: input.orderId });
  if (!itemIdKnown) inventoryItemId = loaded.inventoryItemId;
  if (!quantityKnown) quantity = loaded.quantity;
  if (title == null) title = loaded.title;

  // No catalog link, but a real delivery with a name and a quantity: make its item.
  const deliveredQuantity = Number(quantity);
  if (!parseInventoryItemId(inventoryItemId) && !loaded.columnMissing && Number.isFinite(deliveredQuantity) && deliveredQuantity > 0) {
    try {
      inventoryItemId = await withSavepointOrThrow(client, () =>
        createItemForOrder(client, { orgId: input.orgId, userId: input.userId, orderId: input.orderId, order: { ...loaded, title: title ?? loaded.title } }),
      );
    } catch {
      // Inventory isn't set up for this team (or the row was refused): the receive still stands.
      inventoryItemId = null;
    }
  }

  const plan = planReceiveToInventory({
    inventoryItemId,
    quantity,
    orderId: input.orderId,
    title,
  });
  if (plan.kind === "skip") return { applied: false, reason: plan.reason };

  const already = await client.query(
    `SELECT 1 FROM inventory_transactions
     WHERE item_id = $1::uuid AND source_kind = $2 AND source_id = $3::uuid`,
    [plan.itemId, plan.sourceKind, plan.sourceId],
  );
  if (already.rowCount) return { applied: false, reason: "already_applied" };

  const exists = await client.query(
    `SELECT 1 FROM inventory_items WHERE id = $1::uuid AND org_id = $2::uuid`,
    [plan.itemId, input.orgId],
  );
  if (!exists.rowCount) return { applied: false, reason: "missing_item" };

  try {
    // withSavepointOrThrow, not a plain try: a unique violation is a Postgres
    // error, so by the time this catch classified it as "already_applied" the
    // transaction was already aborted and the caller's next statement — the
    // purchase-order update, or the next line of a multi-line receipt — failed
    // with 25P02. Rolling back to the savepoint first makes "already_applied"
    // and "missing_item" the harmless outcomes they read as.
    await withSavepointOrThrow(client, () =>
      adjustStock(client, {
        orgId: input.orgId,
        userId: input.userId,
        itemId: plan.itemId,
        delta: plan.delta,
        reason: plan.reason,
        note: plan.note,
        sourceKind: plan.sourceKind,
        sourceId: plan.sourceId,
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "Item not found") {
      return { applied: false, reason: "missing_item" };
    }
    if (isUniqueViolation(error)) return { applied: false, reason: "already_applied" };
    throw error;
  }

  return { applied: true, itemId: plan.itemId, delta: plan.delta };
}
