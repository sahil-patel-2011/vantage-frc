// When a purchase request is marked received, append an inventory_transactions
// receipt against the linked catalog item — never invent stock. Missing or
// invalid inventory_item_id skips the ledger and leaves the receive itself alone.
//
// Quantity is the order's own quantity. This module does not create inventory_items
// rows and does not default a count when the order has none.

import type { PoolClient } from "@neondatabase/serverless";
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

async function loadLinkedOrder(
  client: PoolClient,
  input: { orgId: string; orderId: string },
): Promise<{ inventoryItemId: string | null; quantity: number | null; title: string | null }> {
  try {
    const loaded = await client.query<{
      inventoryItemId: string | null;
      quantity: string | number | null;
      title: string | null;
    }>(
      `SELECT inventory_item_id AS "inventoryItemId", quantity, title
       FROM purchase_requests
       WHERE id = $1::uuid AND org_id = $2::uuid`,
      [input.orderId, input.orgId],
    );
    const row = loaded.rows[0];
    if (!row) return { inventoryItemId: null, quantity: null, title: null };
    const quantity = row.quantity == null ? null : Number(row.quantity);
    return {
      inventoryItemId: row.inventoryItemId,
      quantity: Number.isFinite(quantity) ? quantity : null,
      title: row.title,
    };
  } catch (error) {
    if (isMissingItemColumn(error)) return { inventoryItemId: null, quantity: null, title: null };
    throw error;
  }
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
  if (!itemIdKnown || !quantityKnown) {
    const loaded = await loadLinkedOrder(client, { orgId: input.orgId, orderId: input.orderId });
    if (!itemIdKnown) inventoryItemId = loaded.inventoryItemId;
    if (!quantityKnown) quantity = loaded.quantity;
    if (title == null) title = loaded.title;
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
    await adjustStock(client, {
      orgId: input.orgId,
      userId: input.userId,
      itemId: plan.itemId,
      delta: plan.delta,
      reason: plan.reason,
      note: plan.note,
      sourceKind: plan.sourceKind,
      sourceId: plan.sourceId,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Item not found") {
      return { applied: false, reason: "missing_item" };
    }
    if (isUniqueViolation(error)) return { applied: false, reason: "already_applied" };
    throw error;
  }

  return { applied: true, itemId: plan.itemId, delta: plan.delta };
}
