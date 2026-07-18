import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  PACKING_TEMPLATE,
  parsePackingAction,
  type PackingItem,
  type PackingList,
  type PackingView,
} from "../../../lib/packing";

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

async function requireMembership(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`, [orgId, userId]);
  if (!row.rowCount) throw new HttpError(403, "Organization membership required");
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Packing request failed" }, { status });
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
        eventKey: string | null;
      }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role,
                c.active_event_key AS "eventKey"
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         LEFT JOIN org_active_context c ON c.org_id = o.id
         WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
         LIMIT 1`,
        [session.user.id, requestedOrg],
      );

      const row = membership.rows[0];
      if (!row) {
        return {
          status: "setup_required",
          message: "Select a team workspace to build packing lists.",
          context: { orgId: null, orgName: null, teamNumber: null, role: null, eventKey: null },
        } satisfies PackingView;
      }

      const [lists, items] = await Promise.all([
        client.query<Omit<PackingList, "items">>(
          `SELECT l.id, l.title, l.event_key AS "eventKey", u.name AS "createdByName", l.updated_at::text AS "updatedAt"
           FROM packing_lists l
           LEFT JOIN users u ON u.id = l.created_by
           WHERE l.org_id = $1
           ORDER BY l.updated_at DESC
           LIMIT 50`,
          [row.orgId],
        ),
        client.query<PackingItem>(
          `SELECT i.id, i.list_id AS "listId", i.category, i.label, i.quantity, i.packed,
                  pb.name AS "packedByName", i.packed_at::text AS "packedAt", i.sort_order AS "sortOrder"
           FROM packing_items i
           LEFT JOIN users pb ON pb.id = i.packed_by
           WHERE i.org_id = $1
           ORDER BY i.list_id, i.category, i.sort_order`,
          [row.orgId],
        ),
      ]);

      const byList = new Map<string, PackingItem[]>();
      for (const item of items.rows) {
        const list = byList.get(item.listId) ?? [];
        list.push(item);
        byList.set(item.listId, list);
      }

      return {
        status: "ready",
        context: {
          orgId: row.orgId,
          orgName: row.orgName,
          teamNumber: row.teamNumber,
          role: row.role,
          eventKey: row.eventKey,
        },
        lists: lists.rows.map((list) => ({ ...list, items: byList.get(list.id) ?? [] })),
      } satisfies PackingView;
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parsePackingAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      switch (action.action) {
        case "create_list": {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO packing_lists (org_id, title, event_key, created_by)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [action.orgId, action.title, action.eventKey, userId],
          );
          const listId = inserted.rows[0]!.id;
          if (action.seedTemplate) {
            let sort = 0;
            for (const group of PACKING_TEMPLATE) {
              for (const templateItem of group.items) {
                sort += 1;
                await client.query(
                  `INSERT INTO packing_items (org_id, list_id, category, label, quantity, sort_order, created_by)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                  [action.orgId, listId, group.category, templateItem.label, templateItem.quantity, sort, userId],
                );
              }
            }
          }
          return { id: listId };
        }

        case "delete_list": {
          const deleted = await client.query(`DELETE FROM packing_lists WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this list");
          return { ok: true };
        }

        case "reset_list": {
          const updated = await client.query(
            `UPDATE packing_items SET packed = false, packed_by = NULL, packed_at = NULL
             WHERE list_id = $1 AND org_id = $2`,
            [action.id, action.orgId],
          );
          await client.query(`UPDATE packing_lists SET updated_at = now() WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          return { reset: updated.rowCount ?? 0 };
        }

        case "add_item": {
          const next = await client.query<{ next: number }>(
            `SELECT COALESCE(MAX(sort_order) + 1, 1000) AS next FROM packing_items
             WHERE list_id = $1 AND category = $2`,
            [action.listId, action.category],
          );
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO packing_items (org_id, list_id, category, label, quantity, sort_order, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [action.orgId, action.listId, action.category, action.label, action.quantity, next.rows[0]?.next ?? 1000, userId],
          );
          await client.query(`UPDATE packing_lists SET updated_at = now() WHERE id = $1 AND org_id = $2`, [
            action.listId,
            action.orgId,
          ]);
          return { id: inserted.rows[0]!.id };
        }

        case "toggle_item": {
          const updated = await client.query<{ listId: string }>(
            `UPDATE packing_items
             SET packed = $3, packed_by = CASE WHEN $3 THEN $4::uuid ELSE NULL END,
                 packed_at = CASE WHEN $3 THEN now() ELSE NULL END
             WHERE id = $1 AND org_id = $2
             RETURNING list_id AS "listId"`,
            [action.id, action.orgId, action.packed, userId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Item not found");
          await client.query(`UPDATE packing_lists SET updated_at = now() WHERE id = $1 AND org_id = $2`, [
            updated.rows[0]!.listId,
            action.orgId,
          ]);
          return { ok: true };
        }

        case "delete_item": {
          const deleted = await client.query(`DELETE FROM packing_items WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          if (!deleted.rowCount) throw new HttpError(404, "Item not found");
          return { ok: true };
        }

        default:
          throw new HttpError(400, "Unsupported packing action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
