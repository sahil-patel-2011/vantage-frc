// ONE PARTS LEDGER — the single read/write API over the unified stock spine
// (inventory_items + inventory_transactions, see 0462_parts_unify.sql).
//
// Every helper runs inside the caller's withRls transaction (PoolClient), uses parameterized
// SQL only, and upholds one invariant: a quantity NEVER moves without an append-only
// inventory_transactions row in the same transaction. The pure twin of these semantics lives
// in ./ledger.ts and is unit-tested there.

import type { PoolClient } from "@neondatabase/serverless";
import { isLowStock, type LedgerReason } from "./ledger";

export type StockKind = "part" | "consumable";

export type StockLevel = {
  id: string;
  name: string;
  kind: StockKind;
  category: string;
  unit: string;
  quantity: number;
  /** min_quantity on the spine; 0 means "not tracked" and never flags low. */
  reorderLevel: number;
  vendor: string | null;
  subsystem: string | null;
  notes: string;
  archived: boolean;
  low: boolean;
  updatedAt: string;
};

type StockRow = {
  id: string;
  name: string;
  kind: string;
  category: string;
  unit: string;
  quantity: string | number;
  reorderLevel: string | number;
  vendor: string | null;
  subsystem: string | null;
  notes: string;
  archived: boolean;
  updatedAt: string;
};

const num = (value: string | number | null | undefined): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

function mapRow(row: StockRow): StockLevel {
  const quantity = num(row.quantity);
  const reorderLevel = num(row.reorderLevel);
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === "consumable" ? "consumable" : "part",
    category: row.category,
    unit: row.unit,
    quantity,
    reorderLevel,
    vendor: row.vendor,
    subsystem: row.subsystem,
    notes: row.notes,
    archived: row.archived,
    low: !row.archived && isLowStock(quantity, reorderLevel),
    updatedAt: row.updatedAt,
  };
}

const STOCK_SELECT = `
  SELECT i.id, i.name, i.kind, i.category, i.unit,
         i.quantity::float8 AS quantity, i.min_quantity::float8 AS "reorderLevel",
         i.vendor, i.subsystem, i.notes, i.archived, i.updated_at::text AS "updatedAt"
  FROM inventory_items i`;

/** Current stock levels for an org, optionally narrowed to one kind. */
export async function listStockLevels(
  client: PoolClient,
  input: { orgId: string; kind?: StockKind | null; includeArchived?: boolean },
): Promise<StockLevel[]> {
  const result = await client.query<StockRow>(
    `${STOCK_SELECT}
     WHERE i.org_id = $1::uuid
       AND ($2::text IS NULL OR i.kind = $2::text)
       AND ($3::boolean OR i.archived = false)
     ORDER BY i.archived, i.name`,
    [input.orgId, input.kind ?? null, input.includeArchived === true],
  );
  return result.rows.map(mapRow);
}

/** Items at or below their reorder level — only where a real threshold is set. */
export async function listLowStock(client: PoolClient, orgId: string): Promise<StockLevel[]> {
  const result = await client.query<StockRow>(
    `${STOCK_SELECT}
     WHERE i.org_id = $1::uuid AND i.archived = false
       AND i.min_quantity > 0 AND i.quantity <= i.min_quantity
     ORDER BY (i.quantity / i.min_quantity), i.name`,
    [orgId],
  );
  return result.rows.map(mapRow);
}

/**
 * Move stock by `delta` — the ONLY sanctioned way to change a quantity. Appends exactly one
 * ledger row and updates the running total in the same transaction; refuses to go below zero.
 * Returns the new quantity.
 */
export async function adjustStock(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    itemId: string;
    delta: number;
    reason?: LedgerReason;
    note?: string;
    sourceKind?: string;
    sourceId?: string;
  },
): Promise<number> {
  const delta = Math.round(input.delta * 100) / 100;
  if (!Number.isFinite(delta) || delta === 0) throw new Error("Enter a non-zero adjustment");

  const updated = await client.query<{ quantity: number }>(
    `UPDATE inventory_items
     SET quantity = quantity + $1::numeric, updated_at = now()
     WHERE id = $2::uuid AND org_id = $3::uuid AND quantity + $1::numeric >= 0
     RETURNING quantity::float8 AS quantity`,
    [delta, input.itemId, input.orgId],
  );
  if (!updated.rowCount) {
    const exists = await client.query(`SELECT 1 FROM inventory_items WHERE id = $1::uuid AND org_id = $2::uuid`, [
      input.itemId,
      input.orgId,
    ]);
    if (!exists.rowCount) throw new Error("Item not found");
    throw new Error("Adjustment would drop stock below zero");
  }

  await client.query(
    `INSERT INTO inventory_transactions (org_id, item_id, delta, reason, note, created_by, source_kind, source_id)
     VALUES ($1::uuid, $2::uuid, $3::numeric, $4, $5, $6::uuid, $7, $8::uuid)`,
    [
      input.orgId,
      input.itemId,
      delta,
      input.reason ?? "adjust",
      input.note ?? "",
      input.userId,
      input.sourceKind ?? null,
      input.sourceId ?? null,
    ],
  );

  return num(updated.rows[0]!.quantity);
}

/**
 * Set an item's on-hand count to an absolute value — expressed as a ledger movement of the
 * difference, never a bare UPDATE. A no-op when the value already matches.
 */
export async function setStockLevel(
  client: PoolClient,
  input: { orgId: string; userId: string; itemId: string; quantity: number; note?: string },
): Promise<number> {
  const target = Math.max(0, Math.round(input.quantity * 100) / 100);
  const current = await client.query<{ quantity: number }>(
    `SELECT quantity::float8 AS quantity FROM inventory_items WHERE id = $1::uuid AND org_id = $2::uuid FOR UPDATE`,
    [input.itemId, input.orgId],
  );
  if (!current.rowCount) throw new Error("Item not found");
  const delta = Math.round((target - num(current.rows[0]!.quantity)) * 100) / 100;
  if (delta === 0) return target;
  return adjustStock(client, {
    orgId: input.orgId,
    userId: input.userId,
    itemId: input.itemId,
    delta,
    reason: "adjust",
    note: input.note ?? "Set on-hand count",
  });
}

export type ConsumedPart = { itemId: string; quantity: number };
export type ConsumptionResult = { itemId: string; consumed: number; remaining: number | null };

/**
 * Consume stock because a source event happened (e.g. a pit repair was resolved), idempotently:
 * the partial UNIQUE on (item_id, source_kind, source_id) from 0462 means a replay of the same
 * event inserts no second ledger row and moves nothing. The decrement is clamped to what is on
 * hand so the ledger records what actually left the shelf.
 */
export async function consumeForSource(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    sourceKind: string;
    sourceId: string;
    note?: string;
    items: ConsumedPart[];
  },
): Promise<ConsumptionResult[]> {
  const results: ConsumptionResult[] = [];
  for (const part of input.items) {
    const requested = Math.round(part.quantity * 100) / 100;
    if (!Number.isFinite(requested) || requested <= 0) continue;

    const moved = await client.query<{ itemId: string; quantity: number; consumed: number }>(
      `WITH target AS (
         SELECT id, org_id, quantity FROM inventory_items
         WHERE id = $1::uuid AND org_id = $2::uuid
         FOR UPDATE
       ), ledger AS (
         INSERT INTO inventory_transactions (org_id, item_id, delta, reason, note, created_by, source_kind, source_id)
         SELECT t.org_id, t.id, -LEAST(t.quantity, $3::numeric), 'used', $4, $5::uuid, $6, $7::uuid
         FROM target t
         WHERE LEAST(t.quantity, $3::numeric) > 0
         ON CONFLICT (item_id, source_kind, source_id)
           WHERE source_kind IS NOT NULL AND source_id IS NOT NULL
           DO NOTHING
         RETURNING item_id, delta
       )
       UPDATE inventory_items i
       SET quantity = i.quantity + l.delta, updated_at = now()
       FROM ledger l
       WHERE i.id = l.item_id
       RETURNING i.id AS "itemId", i.quantity::float8 AS quantity, (-l.delta)::float8 AS consumed`,
      [part.itemId, input.orgId, requested, input.note ?? "", input.userId, input.sourceKind, input.sourceId],
    );

    const row = moved.rows[0];
    results.push(
      row
        ? { itemId: part.itemId, consumed: num(row.consumed), remaining: num(row.quantity) }
        : { itemId: part.itemId, consumed: 0, remaining: null },
    );
  }
  return results;
}
