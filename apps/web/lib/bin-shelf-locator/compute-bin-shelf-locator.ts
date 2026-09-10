import type { PoolClient } from "@neondatabase/serverless";
import type {
  BinShelfFindResult,
  BinShelfInventoryItem,
  BinShelfItemLocation,
  BinShelfLocation,
  BinShelfLocationKind,
  BinShelfMove,
  BinShelfMoveMethod,
} from "./types";

export const BIN_SHELF_LOCATION_KINDS: BinShelfLocationKind[] = [
  "bin",
  "shelf",
  "zone",
  "cart",
  "drawer",
  "other",
];
export const BIN_SHELF_MOVE_METHODS: BinShelfMoveMethod[] = ["manual", "scan", "putaway", "audit"];

export type BinShelfLocatorSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type BinShelfLocatorView =
  | {
      status: "setup_required";
      message: string;
      steps: BinShelfLocatorSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      locations: BinShelfLocation[];
      placements: BinShelfItemLocation[];
      recentMoves: BinShelfMove[];
      items: BinShelfInventoryItem[];
      computedAt: string;
    };

type LocationRow = {
  id: string;
  code: string;
  kind: BinShelfLocationKind;
  zone: string | null;
  photoUrl: string | null;
  notes: string;
  archived: boolean;
  itemCount: string | number;
  createdAt: string;
};

function mapLocation(row: LocationRow): BinShelfLocation {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    zone: row.zone,
    photoUrl: row.photoUrl,
    notes: row.notes,
    archived: row.archived,
    itemCount: Number(row.itemCount) || 0,
    createdAt: row.createdAt,
  };
}

type ItemLocationRow = {
  id: string;
  itemId: string;
  itemName: string;
  itemCategory: string;
  locationId: string;
  locationCode: string;
  locationKind: BinShelfLocationKind;
  quantity: string | number;
  lastSeenAt: string;
};

function mapItemLocation(row: ItemLocationRow): BinShelfItemLocation {
  return {
    id: row.id,
    itemId: row.itemId,
    itemName: row.itemName,
    itemCategory: row.itemCategory,
    locationId: row.locationId,
    locationCode: row.locationCode,
    locationKind: row.locationKind,
    quantity: Number(row.quantity) || 0,
    lastSeenAt: row.lastSeenAt,
  };
}

type MoveRow = {
  id: string;
  itemId: string;
  itemName: string;
  fromLocationId: string | null;
  fromLocationCode: string | null;
  toLocationId: string | null;
  toLocationCode: string | null;
  quantity: string | number;
  method: BinShelfMoveMethod;
  note: string;
  movedBy: string;
  createdAt: string;
};

function mapMove(row: MoveRow): BinShelfMove {
  return {
    id: row.id,
    itemId: row.itemId,
    itemName: row.itemName,
    fromLocationId: row.fromLocationId,
    fromLocationCode: row.fromLocationCode,
    toLocationId: row.toLocationId,
    toLocationCode: row.toLocationCode,
    quantity: Number(row.quantity) || 0,
    method: row.method,
    note: row.note,
    movedBy: row.movedBy,
    createdAt: row.createdAt,
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

export async function computeBinShelfLocatorView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<BinShelfLocatorView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to set up bin/shelf locations.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const itemCountResult = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM inventory_items WHERE org_id = $1 AND archived = false`,
    [org.orgId],
  );
  const hasItems = Number(itemCountResult.rows[0]?.count ?? 0) > 0;

  const locationsResult = await client.query<LocationRow>(
    `SELECT l.id, l.code, l.kind, l.zone, l.photo_url AS "photoUrl", l.notes, l.archived,
            l.created_at::text AS "createdAt",
            (SELECT count(*) FROM bin_shelf_locator_item_locations il WHERE il.location_id = l.id AND il.quantity > 0) AS "itemCount"
     FROM bin_shelf_locator_locations l
     WHERE l.org_id = $1
     ORDER BY l.archived ASC, l.code ASC`,
    [org.orgId],
  );

  if (!hasItems && locationsResult.rowCount === 0) {
    return {
      status: "setup_required",
      message: "Add inventory items and at least one bin/shelf location before assigning put-away spots.",
      steps: [
        { id: "items", label: "Add inventory items", detail: "Log parts in Inventory first", href: "/inventory" },
        {
          id: "location",
          label: "Create a bin/shelf location",
          detail: "Add a bin, shelf, or zone code below",
          href: "/bin-shelf-locator",
        },
      ],
      orgId: org.orgId,
    };
  }

  const [itemsResult, placementsResult, movesResult] = await Promise.all([
    client.query<{
      id: string;
      name: string;
      category: string;
      partNumber: string | null;
      quantity: string | number;
    }>(
      `SELECT id, name, category, part_number AS "partNumber", quantity
       FROM inventory_items
       WHERE org_id = $1 AND archived = false
       ORDER BY name ASC
       LIMIT 500`,
      [org.orgId],
    ),
    client.query<ItemLocationRow>(
      `SELECT il.id, il.item_id AS "itemId", i.name AS "itemName", i.category AS "itemCategory",
              il.location_id AS "locationId", l.code AS "locationCode", l.kind AS "locationKind",
              il.quantity, il.last_seen_at::text AS "lastSeenAt"
       FROM bin_shelf_locator_item_locations il
       JOIN inventory_items i ON i.id = il.item_id
       JOIN bin_shelf_locator_locations l ON l.id = il.location_id
       WHERE il.org_id = $1 AND il.quantity > 0
       ORDER BY il.last_seen_at DESC
       LIMIT 500`,
      [org.orgId],
    ),
    client.query<MoveRow>(
      `SELECT mv.id, mv.item_id AS "itemId", i.name AS "itemName",
              mv.from_location_id AS "fromLocationId", fl.code AS "fromLocationCode",
              mv.to_location_id AS "toLocationId", tl.code AS "toLocationCode",
              mv.quantity, mv.method, mv.note, mv.moved_by AS "movedBy", mv.created_at::text AS "createdAt"
       FROM bin_shelf_locator_moves mv
       JOIN inventory_items i ON i.id = mv.item_id
       LEFT JOIN bin_shelf_locator_locations fl ON fl.id = mv.from_location_id
       LEFT JOIN bin_shelf_locator_locations tl ON tl.id = mv.to_location_id
       WHERE mv.org_id = $1
       ORDER BY mv.created_at DESC
       LIMIT 50`,
      [org.orgId],
    ),
  ]);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    locations: locationsResult.rows.map(mapLocation),
    placements: placementsResult.rows.map(mapItemLocation),
    recentMoves: movesResult.rows.map(mapMove),
    items: itemsResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      partNumber: row.partNumber,
      quantity: Number(row.quantity) || 0,
    })),
    computedAt: new Date().toISOString(),
  };
}

export async function findItemLocations(
  client: PoolClient,
  input: { orgId: string; itemId: string },
): Promise<BinShelfFindResult | null> {
  const itemResult = await client.query<{ name: string }>(
    `SELECT name FROM inventory_items WHERE id = $1 AND org_id = $2`,
    [input.itemId, input.orgId],
  );
  const itemName = itemResult.rows[0]?.name;
  if (!itemName) return null;

  const [placementsResult, movesResult] = await Promise.all([
    client.query<ItemLocationRow>(
      `SELECT il.id, il.item_id AS "itemId", i.name AS "itemName", i.category AS "itemCategory",
              il.location_id AS "locationId", l.code AS "locationCode", l.kind AS "locationKind",
              il.quantity, il.last_seen_at::text AS "lastSeenAt"
       FROM bin_shelf_locator_item_locations il
       JOIN inventory_items i ON i.id = il.item_id
       JOIN bin_shelf_locator_locations l ON l.id = il.location_id
       WHERE il.org_id = $1 AND il.item_id = $2 AND il.quantity > 0
       ORDER BY il.last_seen_at DESC`,
      [input.orgId, input.itemId],
    ),
    client.query<MoveRow>(
      `SELECT mv.id, mv.item_id AS "itemId", i.name AS "itemName",
              mv.from_location_id AS "fromLocationId", fl.code AS "fromLocationCode",
              mv.to_location_id AS "toLocationId", tl.code AS "toLocationCode",
              mv.quantity, mv.method, mv.note, mv.moved_by AS "movedBy", mv.created_at::text AS "createdAt"
       FROM bin_shelf_locator_moves mv
       JOIN inventory_items i ON i.id = mv.item_id
       LEFT JOIN bin_shelf_locator_locations fl ON fl.id = mv.from_location_id
       LEFT JOIN bin_shelf_locator_locations tl ON tl.id = mv.to_location_id
       WHERE mv.org_id = $1 AND mv.item_id = $2
       ORDER BY mv.created_at DESC
       LIMIT 20`,
      [input.orgId, input.itemId],
    ),
  ]);

  return {
    itemId: input.itemId,
    itemName,
    placements: placementsResult.rows.map(mapItemLocation),
    recentMoves: movesResult.rows.map(mapMove),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createLocation(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    code: string;
    kind: BinShelfLocationKind;
    zone: string | null;
    photoUrl: string | null;
    notes: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO bin_shelf_locator_locations (org_id, code, kind, zone, photo_url, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (org_id, code) DO UPDATE SET kind = EXCLUDED.kind, zone = EXCLUDED.zone,
       photo_url = EXCLUDED.photo_url, notes = EXCLUDED.notes, archived = false`,
    [input.orgId, input.code, input.kind, input.zone, input.photoUrl, input.notes, input.userId],
  );
}

export async function archiveLocation(
  client: PoolClient,
  input: { orgId: string; locationId: string },
): Promise<void> {
  await client.query(
    `UPDATE bin_shelf_locator_locations SET archived = true WHERE id = $1 AND org_id = $2`,
    [input.locationId, input.orgId],
  );
}

/** Puts away (or moves) a quantity of an item into a location, logging the move and updating
 * the quantity-at-location join. Negative-safe: subtracts from the "from" location if given. */
export async function recordMove(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    itemId: string;
    fromLocationId: string | null;
    toLocationId: string | null;
    quantity: number;
    method: BinShelfMoveMethod;
    note: string;
  },
): Promise<void> {
  const quantity = Math.max(0, input.quantity);

  if (input.fromLocationId) {
    await client.query(
      `UPDATE bin_shelf_locator_item_locations
       SET quantity = GREATEST(0, quantity - $1), updated_at = now()
       WHERE org_id = $2 AND item_id = $3 AND location_id = $4`,
      [quantity, input.orgId, input.itemId, input.fromLocationId],
    );
  }

  if (input.toLocationId) {
    await client.query(
      `INSERT INTO bin_shelf_locator_item_locations (org_id, item_id, location_id, quantity, last_seen_at, created_by)
       VALUES ($1,$2,$3,$4, now(), $5)
       ON CONFLICT (org_id, item_id, location_id)
       DO UPDATE SET quantity = bin_shelf_locator_item_locations.quantity + EXCLUDED.quantity,
         last_seen_at = now(), updated_at = now()`,
      [input.orgId, input.itemId, input.toLocationId, quantity, input.userId],
    );
  }

  await client.query(
    `INSERT INTO bin_shelf_locator_moves (
       org_id, item_id, from_location_id, to_location_id, quantity, method, note, moved_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.orgId,
      input.itemId,
      input.fromLocationId,
      input.toLocationId,
      quantity,
      input.method,
      input.note,
      input.userId,
    ],
  );
}

/** Marks an item as "seen" at a location without changing quantity — used by scan-to-find
 * confirmations so the audit trail reflects a physical sighting even with no move of stock. */
export async function recordSighting(
  client: PoolClient,
  input: { orgId: string; userId: string; itemId: string; locationId: string; note: string },
): Promise<void> {
  await client.query(
    `UPDATE bin_shelf_locator_item_locations SET last_seen_at = now(), updated_at = now()
     WHERE org_id = $1 AND item_id = $2 AND location_id = $3`,
    [input.orgId, input.itemId, input.locationId],
  );
  await client.query(
    `INSERT INTO bin_shelf_locator_moves (org_id, item_id, from_location_id, to_location_id, quantity, method, note, moved_by)
     VALUES ($1,$2,$3,$3,0,'audit',$4,$5)`,
    [input.orgId, input.itemId, input.locationId, input.note, input.userId],
  );
}
