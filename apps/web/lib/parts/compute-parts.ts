// ONE PARTS LEDGER — the unified read model for /parts and /api/parts (0505).
//
// Three numbers per item, each derived from real rows and never guessed:
//   on-hand      inventory_items.quantity (the running net of inventory_transactions, 0037/0462)
//   reserved     SUM(inventory_reservations.quantity) WHERE status = 'held'  (0505)
//   available    on-hand - reserved, floored at 0
// plus `unallocatedQuantity` = available - BOM need (bom_entries.quantity_needed summed for the
// item), so a team can see what is genuinely free to promise to a kit, a repair or a print.
// Every query runs under the caller's withRls PoolClient with parameterized SQL only.

import type { PoolClient } from "@neondatabase/serverless";
import { isLowStock } from "./ledger";
import { adjustStock, consumeForSource } from "./store";

export const RESERVATION_SOURCE_KINDS = ["spare_robot_kit", "pit_repair_triage", "bom", "manual"] as const;
export type ReservationSourceKind = (typeof RESERVATION_SOURCE_KINDS)[number];

export const RESERVATION_STATUSES = ["held", "consumed", "released"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export function isReservationSourceKind(value: unknown): value is ReservationSourceKind {
  return typeof value === "string" && (RESERVATION_SOURCE_KINDS as readonly string[]).includes(value);
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export type PartAllocation = {
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  bomNeededQuantity: number;
  /** Available stock not yet spoken for by any BOM line — what can be promised elsewhere. */
  unallocatedQuantity: number;
  /** BOM need the available stock cannot cover. */
  shortfallQuantity: number;
};

/** Pure allocation math shared by the view and its tests. Negative inputs are treated as 0. */
export function computeAllocation(input: { onHand: number; reserved: number; bomNeeded: number }): PartAllocation {
  const onHand = Math.max(0, round2(Number(input.onHand) || 0));
  const reserved = Math.max(0, round2(Number(input.reserved) || 0));
  const bomNeeded = Math.max(0, round2(Number(input.bomNeeded) || 0));
  const available = round2(Math.max(0, onHand - reserved));
  return {
    onHandQuantity: onHand,
    reservedQuantity: reserved,
    availableQuantity: available,
    bomNeededQuantity: bomNeeded,
    unallocatedQuantity: round2(Math.max(0, available - bomNeeded)),
    shortfallQuantity: round2(Math.max(0, bomNeeded - available)),
  };
}

export type PartStock = PartAllocation & {
  id: string;
  name: string;
  kind: "part" | "consumable";
  category: string;
  unit: string;
  partNumber: string | null;
  vendor: string | null;
  subsystem: string | null;
  locationId: string | null;
  locationName: string | null;
  reorderLevel: number;
  unitCost: number | null;
  archived: boolean;
  low: boolean;
  updatedAt: string;
};

export type PartReservation = {
  id: string;
  itemId: string;
  itemName: string;
  quantity: number;
  sourceKind: ReservationSourceKind;
  sourceId: string | null;
  status: ReservationStatus;
  note: string;
  createdAt: string;
};

export type PartsLocation = {
  id: string;
  name: string;
  kind: string;
  itemCount: number;
  onHandQuantity: number;
};

export type PartsSummary = {
  itemCount: number;
  lowCount: number;
  heldReservationCount: number;
  reservedQuantity: number;
  /** Items whose BOM need exceeds what is available. */
  shortItemCount: number;
};

export type PartsView =
  | {
      status: "setup_required";
      message: string;
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      orgName: string;
      teamNumber: number | null;
      role: string;
      items: PartStock[];
      reservations: PartReservation[];
      locations: PartsLocation[];
      summary: PartsSummary;
      computedAt: string;
    };

type StockRow = {
  id: string;
  name: string;
  kind: string;
  category: string;
  unit: string;
  partNumber: string | null;
  vendor: string | null;
  subsystem: string | null;
  locationId: string | null;
  locationName: string | null;
  quantity: string | number;
  reorderLevel: string | number;
  unitCost: string | number | null;
  archived: boolean;
  updatedAt: string;
  reserved: string | number | null;
  bomNeeded: string | number | null;
};

type ReservationRow = {
  id: string;
  itemId: string;
  itemName: string;
  quantity: string | number;
  sourceKind: string;
  sourceId: string | null;
  status: string;
  note: string;
  createdAt: string;
};

type LocationRow = {
  id: string;
  name: string;
  kind: string;
  itemCount: string | number;
  onHandQuantity: string | number | null;
};

const num = (value: string | number | null | undefined): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

function mapStock(row: StockRow): PartStock {
  const allocation = computeAllocation({
    onHand: num(row.quantity),
    reserved: num(row.reserved),
    bomNeeded: num(row.bomNeeded),
  });
  const reorderLevel = num(row.reorderLevel);
  return {
    ...allocation,
    id: row.id,
    name: row.name,
    kind: row.kind === "consumable" ? "consumable" : "part",
    category: row.category,
    unit: row.unit,
    partNumber: row.partNumber,
    vendor: row.vendor,
    subsystem: row.subsystem,
    locationId: row.locationId,
    locationName: row.locationName,
    reorderLevel,
    unitCost: row.unitCost == null ? null : num(row.unitCost),
    archived: row.archived,
    low: !row.archived && isLowStock(allocation.availableQuantity, reorderLevel),
    updatedAt: row.updatedAt,
  };
}

export function summarizeParts(items: readonly PartStock[], reservations: readonly PartReservation[]): PartsSummary {
  const active = items.filter((item) => !item.archived);
  const held = reservations.filter((reservation) => reservation.status === "held");
  return {
    itemCount: active.length,
    lowCount: active.filter((item) => item.low).length,
    heldReservationCount: held.length,
    reservedQuantity: round2(held.reduce((sum, reservation) => sum + reservation.quantity, 0)),
    shortItemCount: active.filter((item) => item.shortfallQuantity > 0).length,
  };
}

export async function computePartsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; includeArchived?: boolean },
): Promise<PartsView> {
  const membership = await client.query<{ orgId: string; orgName: string; teamNumber: number | null; role: string }>(
    `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role::text AS role
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1::uuid AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [input.userId, input.requestedOrg],
  );
  const org = membership.rows[0];
  if (!org) {
    return { status: "setup_required", message: "Select a team workspace to see unified parts stock.", orgId: null };
  }

  const [stockResult, reservationResult, locationResult] = await Promise.all([
    client.query<StockRow>(
      `SELECT i.id, i.name, i.kind, i.category, i.unit, i.part_number AS "partNumber", i.vendor, i.subsystem,
              i.location_id AS "locationId", l.name AS "locationName",
              i.quantity::float8 AS quantity, i.min_quantity::float8 AS "reorderLevel",
              i.unit_cost::float8 AS "unitCost", i.archived, i.updated_at::text AS "updatedAt",
              (SELECT COALESCE(SUM(r.quantity), 0)::float8 FROM inventory_reservations r
                WHERE r.item_id = i.id AND r.org_id = i.org_id AND r.status = 'held') AS reserved,
              (SELECT COALESCE(SUM(b.quantity_needed), 0)::float8 FROM bom_entries b
                WHERE b.item_id = i.id AND b.org_id = i.org_id) AS "bomNeeded"
       FROM inventory_items i
       LEFT JOIN inventory_locations l ON l.id = i.location_id AND l.org_id = i.org_id
       WHERE i.org_id = $1::uuid AND ($2::boolean OR i.archived = false)
       ORDER BY i.archived, i.name
       LIMIT 1000`,
      [org.orgId, input.includeArchived === true],
    ),
    client.query<ReservationRow>(
      `SELECT r.id, r.item_id AS "itemId", i.name AS "itemName", r.quantity::float8 AS quantity,
              r.source_kind AS "sourceKind", r.source_id AS "sourceId", r.status, r.note,
              r.created_at::text AS "createdAt"
       FROM inventory_reservations r
       JOIN inventory_items i ON i.id = r.item_id
       WHERE r.org_id = $1::uuid
       ORDER BY (r.status = 'held') DESC, r.created_at DESC
       LIMIT 300`,
      [org.orgId],
    ),
    client.query<LocationRow>(
      `SELECT l.id, l.name, l.kind,
              (SELECT count(*)::int FROM inventory_items i WHERE i.location_id = l.id AND i.archived = false) AS "itemCount",
              (SELECT COALESCE(SUM(i.quantity), 0)::float8 FROM inventory_items i
                WHERE i.location_id = l.id AND i.archived = false) AS "onHandQuantity"
       FROM inventory_locations l
       WHERE l.org_id = $1::uuid
       ORDER BY l.name`,
      [org.orgId],
    ),
  ]);

  const items = stockResult.rows.map(mapStock);
  const reservations: PartReservation[] = reservationResult.rows.map((row) => ({
    id: row.id,
    itemId: row.itemId,
    itemName: row.itemName,
    quantity: num(row.quantity),
    sourceKind: isReservationSourceKind(row.sourceKind) ? row.sourceKind : "manual",
    sourceId: row.sourceId,
    status: (RESERVATION_STATUSES as readonly string[]).includes(row.status)
      ? (row.status as ReservationStatus)
      : "held",
    note: row.note ?? "",
    createdAt: row.createdAt,
  }));
  const locations: PartsLocation[] = locationResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    itemCount: num(row.itemCount),
    onHandQuantity: num(row.onHandQuantity),
  }));

  return {
    status: "live",
    orgId: org.orgId,
    orgName: org.orgName,
    teamNumber: org.teamNumber,
    role: org.role,
    items,
    reservations,
    locations,
    summary: summarizeParts(items, reservations),
    computedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- writes (caller's withRls transaction)

/**
 * Hold stock for a kit / repair / BOM / manual reason. Refuses to promise more than is
 * available right now — a reservation is a claim on real shelf stock, not a wish list.
 */
export async function reservePart(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    itemId: string;
    quantity: number;
    sourceKind: ReservationSourceKind;
    sourceId?: string | null;
    note?: string;
  },
): Promise<{ reservationId: string; availableQuantity: number }> {
  const quantity = round2(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Reserve a quantity greater than zero");

  const current = await client.query<{ quantity: number; reserved: number }>(
    `SELECT i.quantity::float8 AS quantity,
            (SELECT COALESCE(SUM(r.quantity), 0)::float8 FROM inventory_reservations r
              WHERE r.item_id = i.id AND r.org_id = i.org_id AND r.status = 'held') AS reserved
     FROM inventory_items i
     WHERE i.id = $1::uuid AND i.org_id = $2::uuid
     FOR UPDATE`,
    [input.itemId, input.orgId],
  );
  const row = current.rows[0];
  if (!row) throw new Error("Item not found");
  const available = round2(Math.max(0, num(row.quantity) - num(row.reserved)));
  if (quantity > available) throw new Error(`Only ${available} available to reserve`);

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO inventory_reservations (org_id, item_id, quantity, source_kind, source_id, note, created_by)
     VALUES ($1::uuid, $2::uuid, $3::numeric, $4, $5::uuid, $6, $7::uuid)
     RETURNING id`,
    [input.orgId, input.itemId, quantity, input.sourceKind, input.sourceId ?? null, input.note ?? "", input.userId],
  );
  return { reservationId: inserted.rows[0]!.id, availableQuantity: round2(available - quantity) };
}

/** Give a hold back to the shelf. Only a held reservation can be released. */
export async function releaseReservation(
  client: PoolClient,
  input: { orgId: string; reservationId: string },
): Promise<void> {
  const updated = await client.query(
    `UPDATE inventory_reservations SET status = 'released', updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid AND status = 'held'`,
    [input.reservationId, input.orgId],
  );
  if (!updated.rowCount) throw new Error("Reservation is not held");
}

/**
 * Turn a hold into a real movement: the reservation flips to 'consumed' and the stock leaves
 * through consumeForSource keyed to the reservation, so a replay cannot double-decrement.
 */
export async function consumeReservation(
  client: PoolClient,
  input: { orgId: string; userId: string; reservationId: string },
): Promise<{ consumed: number; remaining: number | null }> {
  const updated = await client.query<{ itemId: string; quantity: number; note: string }>(
    `UPDATE inventory_reservations SET status = 'consumed', updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid AND status = 'held'
     RETURNING item_id AS "itemId", quantity::float8 AS quantity, note`,
    [input.reservationId, input.orgId],
  );
  const row = updated.rows[0];
  if (!row) throw new Error("Reservation is not held");
  const [result] = await consumeForSource(client, {
    orgId: input.orgId,
    userId: input.userId,
    sourceKind: "reservation",
    sourceId: input.reservationId,
    note: row.note || "Consumed reservation",
    items: [{ itemId: row.itemId, quantity: num(row.quantity) }],
  });
  return { consumed: result?.consumed ?? 0, remaining: result?.remaining ?? null };
}

/** Manual receive / consume from the hub — same ledger path as Inventory's +/- buttons. */
export async function movePart(
  client: PoolClient,
  input: { orgId: string; userId: string; itemId: string; quantity: number; direction: "receive" | "consume"; note?: string },
): Promise<number> {
  const quantity = round2(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Enter a quantity greater than zero");
  return adjustStock(client, {
    orgId: input.orgId,
    userId: input.userId,
    itemId: input.itemId,
    delta: input.direction === "receive" ? quantity : -quantity,
    reason: input.direction === "receive" ? "received" : "used",
    note: input.note,
  });
}
