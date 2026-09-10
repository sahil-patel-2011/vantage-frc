// Consumables view over the ONE PARTS LEDGER (0462_parts_unify.sql).
// Consumables are inventory_items rows with kind='consumable': on_hand -> quantity,
// reorder_point -> min_quantity, preferred_vendor -> vendor. Every count change goes through
// the append-only inventory_transactions ledger via lib/parts/store — never a bare UPDATE —
// so BOM coverage, low-stock rollups, forecasts and pit-repair triage all see the same numbers.

import type { PoolClient } from "@neondatabase/serverless";
import { sortSpares, summarizeSpares } from ".";
import { adjustStock as adjustLedgerStock, setStockLevel } from "../parts/store";
import type { Consumable, ConsumableCategory, SparesSummary } from "./types";

export const CONSUMABLE_CATEGORIES: ConsumableCategory[] = [
  "fasteners",
  "electrical",
  "pneumatics",
  "adhesives",
  "stock",
  "tools",
  "ppe",
  "other",
];

export type SparesSetupStep = { id: string; label: string; detail: string; href: string };

export type SparesView =
  | {
      status: "setup_required";
      message: string;
      steps: SparesSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      items: Consumable[];
      summary: SparesSummary;
      computedAt: string;
    };

type ItemRow = {
  id: string;
  name: string;
  category: string;
  isSpare: boolean;
  unit: string;
  onHand: string | number | null;
  reorderPoint: string | number | null;
  preferredVendor: string | null;
  notes: string | null;
};

function num(value: string | number | null): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Unified rows keep their category verbatim; anything outside the taxonomy reads as "other". */
function asConsumableCategory(value: string): ConsumableCategory {
  return (CONSUMABLE_CATEGORIES as string[]).includes(value) ? (value as ConsumableCategory) : "other";
}

function mapItem(row: ItemRow): Consumable {
  return {
    id: row.id,
    name: row.name,
    category: asConsumableCategory(row.category),
    unit: row.unit,
    onHand: num(row.onHand),
    reorderPoint: num(row.reorderPoint),
    preferredVendor: row.preferredVendor,
    notes: row.notes?.trim() ? row.notes : null,
    isSpare: Boolean(row.isSpare),
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

export async function computeSparesView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<SparesView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to track consumables and spares.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const result = await client.query<ItemRow>(
    `SELECT id, name, category, unit, quantity AS "onHand", min_quantity AS "reorderPoint",
            vendor AS "preferredVendor", notes, is_spare AS "isSpare"
     FROM inventory_items
     WHERE org_id = $1 AND kind = 'consumable' AND archived = false`,
    [org.orgId],
  );

  const items = sortSpares(result.rows.map(mapItem));

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    items,
    summary: summarizeSpares(items),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createConsumable(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    name: string;
    category: ConsumableCategory;
    unit: string;
    onHand: number;
    reorderPoint: number;
    preferredVendor: string | null;
    notes: string | null;
    /** Also held as a competition spare — puts this row in Spare Forecast. */
    isSpare?: boolean;
  },
): Promise<void> {
  const onHand = Math.max(0, input.onHand);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO inventory_items (org_id, name, category, kind, unit, quantity, min_quantity, vendor, notes, is_spare, created_by)
     VALUES ($1, $2, $3, 'consumable', $4, $5::numeric, $6::numeric, $7, $8, $9::boolean, $10)
     RETURNING id`,
    [
      input.orgId,
      input.name,
      input.category,
      input.unit || "each",
      onHand,
      Math.max(0, input.reorderPoint),
      input.preferredVendor,
      input.notes ?? "",
      input.isSpare ?? false,
      input.userId,
    ],
  );
  if (onHand > 0) {
    await client.query(
      `INSERT INTO inventory_transactions (org_id, item_id, delta, reason, note, created_by)
       VALUES ($1, $2, $3::numeric, 'received', 'Initial stock', $4)`,
      [input.orgId, inserted.rows[0]!.id, onHand, input.userId],
    );
  }
}

export async function updateConsumable(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    itemId: string;
    name?: string;
    category?: ConsumableCategory;
    unit?: string;
    onHand?: number;
    reorderPoint?: number;
    preferredVendor?: string | null;
    notes?: string | null;
    isSpare?: boolean;
  },
): Promise<void> {
  const updated = await client.query(
    `UPDATE inventory_items SET
       name = COALESCE($3, name),
       category = COALESCE($4, category),
       unit = COALESCE($5, unit),
       min_quantity = COALESCE($6::numeric, min_quantity),
       vendor = CASE WHEN $7::boolean THEN $8 ELSE vendor END,
       notes = CASE WHEN $9::boolean THEN COALESCE($10, '') ELSE notes END,
       is_spare = COALESCE($11::boolean, is_spare),
       updated_at = now()
     WHERE id = $1 AND org_id = $2 AND kind = 'consumable'`,
    [
      input.itemId,
      input.orgId,
      input.name ?? null,
      input.category ?? null,
      input.unit ?? null,
      input.reorderPoint == null ? null : Math.max(0, input.reorderPoint),
      input.preferredVendor !== undefined,
      input.preferredVendor ?? null,
      input.notes !== undefined,
      input.notes ?? null,
      input.isSpare ?? null,
    ],
  );
  if (!updated.rowCount) throw new Error("Consumable not found");

  // An absolute on-hand edit becomes a ledger movement of the difference — never a bare UPDATE.
  if (input.onHand != null) {
    await setStockLevel(client, {
      orgId: input.orgId,
      userId: input.userId,
      itemId: input.itemId,
      quantity: Math.max(0, input.onHand),
      note: "Set on-hand from Spares",
    });
  }
}

/** +/- movement from the Spares page; clamped at zero (counting can drift below reality). */
export async function adjustStock(
  client: PoolClient,
  input: { orgId: string; userId: string; itemId: string; delta: number },
): Promise<void> {
  const current = await client.query<{ quantity: number }>(
    `SELECT quantity::float8 AS quantity FROM inventory_items
     WHERE id = $1 AND org_id = $2 AND kind = 'consumable'
     FOR UPDATE`,
    [input.itemId, input.orgId],
  );
  if (!current.rowCount) throw new Error("Consumable not found");
  const onHand = Number(current.rows[0]!.quantity) || 0;
  const effective = Math.max(input.delta, -onHand);
  if (effective === 0) return;
  await adjustLedgerStock(client, {
    orgId: input.orgId,
    userId: input.userId,
    itemId: input.itemId,
    delta: effective,
    reason: effective > 0 ? "received" : "used",
    note: "Count from Spares",
  });
}

export async function deleteConsumable(
  client: PoolClient,
  input: { orgId: string; itemId: string },
): Promise<void> {
  await client.query(`DELETE FROM inventory_items WHERE id = $1 AND org_id = $2 AND kind = 'consumable'`, [
    input.itemId,
    input.orgId,
  ]);
}
