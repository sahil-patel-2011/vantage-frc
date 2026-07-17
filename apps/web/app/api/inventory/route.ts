import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  parseInventoryAction,
  type BomEntry,
  type InventoryItem,
  type InventoryLocation,
  type InventoryTransaction,
  type InventoryView,
  type ItemPatch,
  type LocationPatch,
} from "../../../lib/inventory";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Authentication required");
  return session;
}

async function membershipRole(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query<{ role: string }>(
    `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
    [orgId, userId],
  );
  if (!row.rowCount) throw new HttpError(403, "Organization membership required");
  return row.rows[0]!.role;
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Inventory request failed" }, { status });
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<{
        orgId: string;
        orgName: string;
        teamNumber: number | null;
        role: string;
      }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
         LIMIT 1`,
        [session.user.id, requestedOrg],
      );

      const row = membership.rows[0];
      if (!row) {
        return {
          status: "setup_required",
          message: "Select a team workspace to manage inventory.",
          context: { orgId: null, orgName: null, teamNumber: null, role: null },
        } satisfies InventoryView;
      }

      const [items, locations, transactions, bom] = await Promise.all([
        client.query<InventoryItem>(
          `SELECT i.id, i.name, i.category, i.part_number AS "partNumber", i.vendor, i.unit,
                  i.quantity::float8 AS quantity, i.min_quantity::float8 AS "minQuantity",
                  i.unit_cost::float8 AS "unitCost", i.location_id AS "locationId", l.name AS "locationName",
                  i.subsystem, i.notes, i.archived, i.updated_at::text AS "updatedAt"
           FROM inventory_items i
           LEFT JOIN inventory_locations l ON l.id = i.location_id
           WHERE i.org_id = $1
           ORDER BY i.archived, i.name`,
          [row.orgId],
        ),
        client.query<InventoryLocation>(
          `SELECT l.id, l.name, l.kind, l.notes,
                  (SELECT count(*)::int FROM inventory_items i WHERE i.location_id = l.id) AS "itemCount"
           FROM inventory_locations l
           WHERE l.org_id = $1
           ORDER BY l.name`,
          [row.orgId],
        ),
        client.query<InventoryTransaction>(
          `SELECT t.id, t.item_id AS "itemId", i.name AS "itemName", t.delta::float8 AS delta,
                  t.reason, t.note, u.name AS "byName", t.created_at::text AS "createdAt"
           FROM inventory_transactions t
           LEFT JOIN inventory_items i ON i.id = t.item_id
           LEFT JOIN users u ON u.id = t.created_by
           WHERE t.org_id = $1
           ORDER BY t.created_at DESC
           LIMIT 60`,
          [row.orgId],
        ),
        client.query<BomEntry>(
          `SELECT id, subsystem, item_id AS "itemId", quantity_needed::float8 AS "quantityNeeded", notes
           FROM bom_entries WHERE org_id = $1 ORDER BY subsystem, id`,
          [row.orgId],
        ),
      ]);

      return {
        status: "ready",
        context: { orgId: row.orgId, orgName: row.orgName, teamNumber: row.teamNumber, role: row.role },
        items: items.rows,
        locations: locations.rows,
        transactions: transactions.rows,
        bom: bom.rows,
      } satisfies InventoryView;
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseInventoryAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await membershipRole(client, action.orgId, userId);

      switch (action.action) {
        case "create_item": {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO inventory_items
               (org_id, name, category, part_number, vendor, unit, quantity, min_quantity, unit_cost, location_id, subsystem, notes, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid, $11, $12, $13)
             RETURNING id`,
            [
              action.orgId,
              action.name,
              action.category,
              action.partNumber,
              action.vendor,
              action.unit,
              action.initialQuantity,
              action.minQuantity,
              action.unitCost,
              action.locationId,
              action.subsystem,
              action.notes,
              userId,
            ],
          );
          const itemId = inserted.rows[0]!.id;
          if (action.initialQuantity !== 0) {
            await client.query(
              `INSERT INTO inventory_transactions (org_id, item_id, delta, reason, note, created_by)
               VALUES ($1, $2, $3, 'received', 'Initial stock', $4)`,
              [action.orgId, itemId, action.initialQuantity, userId],
            );
          }
          return { id: itemId };
        }

        case "update_item": {
          const { clause, values } = buildItemUpdate(action.patch);
          const updated = await client.query(
            `UPDATE inventory_items SET ${clause}, updated_at = now()
             WHERE id = $${values.length + 1} AND org_id = $${values.length + 2}`,
            [...values, action.id, action.orgId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Item not found");
          return { ok: true };
        }

        case "delete_item": {
          const deleted = await client.query(`DELETE FROM inventory_items WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this item");
          return { ok: true };
        }

        case "adjust_stock": {
          // Atomic within the RLS transaction; the guard blocks stock going negative.
          const updated = await client.query<{ quantity: string }>(
            `UPDATE inventory_items SET quantity = quantity + $1, updated_at = now()
             WHERE id = $2 AND org_id = $3 AND quantity + $1 >= 0
             RETURNING quantity::float8 AS quantity`,
            [action.delta, action.itemId, action.orgId],
          );
          if (!updated.rowCount) {
            const exists = await client.query(`SELECT 1 FROM inventory_items WHERE id = $1 AND org_id = $2`, [
              action.itemId,
              action.orgId,
            ]);
            if (!exists.rowCount) throw new HttpError(404, "Item not found");
            throw new HttpError(400, "Adjustment would drop stock below zero");
          }
          await client.query(
            `INSERT INTO inventory_transactions (org_id, item_id, delta, reason, note, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [action.orgId, action.itemId, action.delta, action.reason, action.note, userId],
          );
          return { quantity: Number(updated.rows[0]!.quantity) };
        }

        case "create_location": {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO inventory_locations (org_id, name, kind, notes, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [action.orgId, action.name, action.kind, action.notes, userId],
          );
          return { id: inserted.rows[0]!.id };
        }

        case "update_location": {
          const { clause, values } = buildLocationUpdate(action.patch);
          const updated = await client.query(
            `UPDATE inventory_locations SET ${clause}
             WHERE id = $${values.length + 1} AND org_id = $${values.length + 2}`,
            [...values, action.id, action.orgId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Location not found");
          return { ok: true };
        }

        case "delete_location": {
          const deleted = await client.query(`DELETE FROM inventory_locations WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this location");
          return { ok: true };
        }

        case "set_bom": {
          await client.query(
            `INSERT INTO bom_entries (org_id, subsystem, item_id, quantity_needed, notes, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (org_id, subsystem, item_id) DO UPDATE SET
               quantity_needed = excluded.quantity_needed, notes = excluded.notes`,
            [action.orgId, action.subsystem, action.itemId, action.quantityNeeded, action.notes, userId],
          );
          return { ok: true };
        }

        case "delete_bom": {
          const deleted = await client.query(`DELETE FROM bom_entries WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          if (!deleted.rowCount) throw new HttpError(404, "BOM entry not found");
          return { ok: true };
        }

        default:
          throw new HttpError(400, "Unsupported inventory action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}

function buildItemUpdate(patch: ItemPatch) {
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown, cast = "") => {
    values.push(value);
    sets.push(`${column} = $${values.length}${cast}`);
  };
  if (patch.name !== undefined) add("name", patch.name);
  if (patch.category !== undefined) add("category", patch.category);
  if (patch.unit !== undefined) add("unit", patch.unit);
  if (patch.partNumber !== undefined) add("part_number", patch.partNumber);
  if (patch.vendor !== undefined) add("vendor", patch.vendor);
  if (patch.minQuantity !== undefined) add("min_quantity", patch.minQuantity);
  if (patch.unitCost !== undefined) add("unit_cost", patch.unitCost);
  if (patch.locationId !== undefined) add("location_id", patch.locationId, "::uuid");
  if (patch.subsystem !== undefined) add("subsystem", patch.subsystem);
  if (patch.notes !== undefined) add("notes", patch.notes);
  if (patch.archived !== undefined) add("archived", patch.archived);
  if (!sets.length) throw new HttpError(400, "No changes provided");
  return { clause: sets.join(", "), values };
}

function buildLocationUpdate(patch: LocationPatch) {
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (patch.name !== undefined) add("name", patch.name);
  if (patch.kind !== undefined) add("kind", patch.kind);
  if (patch.notes !== undefined) add("notes", patch.notes);
  if (!sets.length) throw new HttpError(400, "No changes provided");
  return { clause: sets.join(", "), values };
}
