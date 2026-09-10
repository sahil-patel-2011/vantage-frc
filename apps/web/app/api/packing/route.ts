import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  PACKING_TEMPLATE,
  canDismissPackingRequest,
  canManagePackingMaster,
  parsePackingAction,
  pendingPackingRequests,
  type PackingItem,
  type PackingList,
  type PackingRequest,
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
  const row = await client.query<{ role: string }>(
    `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
    [orgId, userId],
  );
  if (!row.rowCount) throw new HttpError(403, "Organization membership required");
  return row.rows[0]!.role;
}

function displayName(user: { name?: string | null }): string {
  const name = typeof user.name === "string" ? user.name.trim() : "";
  return name || "Member";
}

function isMissingRelation(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return code === "42P01" || /packing_requests|does not exist/i.test(message);
}

function isMissingAssigneeColumn(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return code === "42703" || /assigned_user_id/i.test(message);
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
          message: "Select a team to build packing lists.",
          context: { orgId: null, orgName: null, teamNumber: null, role: null, eventKey: null },
        } satisfies PackingView;
      }

      const [lists, items, requestResult] = await Promise.all([
        client.query<Omit<PackingList, "items" | "requests" | "canManageMaster">>(
          `SELECT l.id, l.title, l.event_key AS "eventKey", l.created_by AS "createdBy",
                  u.name AS "createdByName", l.updated_at::text AS "updatedAt"
           FROM packing_lists l
           LEFT JOIN users u ON u.id = l.created_by
           WHERE l.org_id = $1
           ORDER BY l.updated_at DESC
           LIMIT 50`,
          [row.orgId],
        ),
        client
          .query<PackingItem>(
            `SELECT i.id, i.list_id AS "listId", i.category, i.label, i.quantity, i.packed,
                    i.assigned_user_id AS "assignedUserId", au.name AS "assignedUserName",
                    pb.name AS "packedByName", i.packed_at::text AS "packedAt", i.sort_order AS "sortOrder"
             FROM packing_items i
             LEFT JOIN users pb ON pb.id = i.packed_by
             LEFT JOIN users au ON au.id = i.assigned_user_id
             WHERE i.org_id = $1
             ORDER BY i.list_id, i.category, i.sort_order`,
            [row.orgId],
          )
          .catch((error) => {
            if (!isMissingAssigneeColumn(error)) throw error;
            return client.query<PackingItem>(
              `SELECT i.id, i.list_id AS "listId", i.category, i.label, i.quantity, i.packed,
                      NULL::uuid AS "assignedUserId", NULL::text AS "assignedUserName",
                      pb.name AS "packedByName", i.packed_at::text AS "packedAt", i.sort_order AS "sortOrder"
               FROM packing_items i
               LEFT JOIN users pb ON pb.id = i.packed_by
               WHERE i.org_id = $1
               ORDER BY i.list_id, i.category, i.sort_order`,
              [row.orgId],
            );
          }),
        client
          .query<PackingRequest>(
            `SELECT r.id, r.list_id AS "listId", r.category, r.label, r.quantity,
                    COALESCE(r.note, '') AS note, r.requested_by AS "requestedBy",
                    r.requested_name AS "requestedName", r.status, r.created_at::text AS "createdAt"
             FROM packing_requests r
             WHERE r.org_id = $1 AND r.status = 'pending'
             ORDER BY r.created_at`,
            [row.orgId],
          )
          .catch((error) => {
            if (isMissingRelation(error)) return { rows: [] as PackingRequest[] };
            throw error;
          }),
      ]);

      const byList = new Map<string, PackingItem[]>();
      for (const item of items.rows) {
        const list = byList.get(item.listId) ?? [];
        list.push(item);
        byList.set(item.listId, list);
      }

      const requestsByList = new Map<string, PackingRequest[]>();
      for (const request of pendingPackingRequests(requestResult.rows)) {
        const list = requestsByList.get(request.listId) ?? [];
        list.push(request);
        requestsByList.set(request.listId, list);
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
        lists: lists.rows.map((list) => ({
          ...list,
          items: byList.get(list.id) ?? [],
          requests: requestsByList.get(list.id) ?? [],
          canManageMaster: canManagePackingMaster(row.role, list.createdBy, session.user.id),
        })),
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
      const role = await requireMembership(client, action.orgId, userId);

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
          const list = await client.query<{ createdBy: string }>(
            `SELECT created_by AS "createdBy" FROM packing_lists WHERE id = $1 AND org_id = $2`,
            [action.listId, action.orgId],
          );
          if (!list.rowCount) throw new HttpError(404, "List not found");
          if (!canManagePackingMaster(role, list.rows[0]!.createdBy, userId)) {
            throw new HttpError(403, "Only the packing lead can add items to the master list — submit a request instead.");
          }
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

        case "request_item": {
          const list = await client.query(`SELECT 1 FROM packing_lists WHERE id = $1 AND org_id = $2`, [
            action.listId,
            action.orgId,
          ]);
          if (!list.rowCount) throw new HttpError(404, "List not found");
          try {
            const inserted = await client.query<{ id: string }>(
              `INSERT INTO packing_requests (
                 org_id, list_id, category, label, quantity, note, requested_by, requested_name
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
              [
                action.orgId,
                action.listId,
                action.category,
                action.label,
                action.quantity,
                action.note,
                userId,
                displayName(session.user),
              ],
            );
            return { id: inserted.rows[0]!.id };
          } catch (error) {
            if (isMissingRelation(error)) {
              throw new HttpError(503, "Packing requests need database migration 0437.");
            }
            throw error;
          }
        }

        case "accept_request":
        case "dismiss_request": {
          let requestRow: {
            listId: string;
            createdBy: string;
            requestedBy: string;
            category: string;
            label: string;
            quantity: number;
            status: string;
          };
          try {
            const found = await client.query<{
              listId: string;
              createdBy: string;
              requestedBy: string;
              category: string;
              label: string;
              quantity: number;
              status: string;
            }>(
              `SELECT r.list_id AS "listId", l.created_by AS "createdBy", r.requested_by AS "requestedBy",
                      r.category, r.label, r.quantity, r.status
               FROM packing_requests r
               JOIN packing_lists l ON l.id = r.list_id AND l.org_id = r.org_id
               WHERE r.id = $1 AND r.org_id = $2`,
              [action.id, action.orgId],
            );
            if (!found.rowCount) throw new HttpError(404, "Request not found");
            requestRow = found.rows[0]!;
          } catch (error) {
            if (isMissingRelation(error)) {
              throw new HttpError(503, "Packing requests need database migration 0437.");
            }
            throw error;
          }
          if (requestRow.status !== "pending") throw new HttpError(409, "Request already decided");

          if (action.action === "dismiss_request") {
            if (!canDismissPackingRequest(role, requestRow.createdBy, userId, requestRow.requestedBy)) {
              throw new HttpError(403, "You cannot dismiss this packing request");
            }
            await client.query(
              `UPDATE packing_requests
               SET status = 'dismissed', decided_by = $3, decided_at = now()
               WHERE id = $1 AND org_id = $2 AND status = 'pending'`,
              [action.id, action.orgId, userId],
            );
            return { ok: true };
          }

          if (!canManagePackingMaster(role, requestRow.createdBy, userId)) {
            throw new HttpError(403, "Only the packing lead can add this to the master list");
          }
          const next = await client.query<{ next: number }>(
            `SELECT COALESCE(MAX(sort_order) + 1, 1000) AS next FROM packing_items
             WHERE list_id = $1 AND category = $2`,
            [requestRow.listId, requestRow.category],
          );
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO packing_items (org_id, list_id, category, label, quantity, sort_order, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [
              action.orgId,
              requestRow.listId,
              requestRow.category,
              requestRow.label,
              requestRow.quantity,
              next.rows[0]?.next ?? 1000,
              userId,
            ],
          );
          await client.query(
            `UPDATE packing_requests
             SET status = 'accepted', decided_by = $3, decided_at = now(), packing_item_id = $4
             WHERE id = $1 AND org_id = $2 AND status = 'pending'`,
            [action.id, action.orgId, userId, inserted.rows[0]!.id],
          );
          await client.query(`UPDATE packing_lists SET updated_at = now() WHERE id = $1 AND org_id = $2`, [
            requestRow.listId,
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

        case "assign_item": {
          const found = await client.query<{ createdBy: string }>(
            `SELECT l.created_by AS "createdBy"
             FROM packing_items i
             JOIN packing_lists l ON l.id = i.list_id AND l.org_id = i.org_id
             WHERE i.id = $1 AND i.org_id = $2`,
            [action.id, action.orgId],
          );
          if (!found.rowCount) throw new HttpError(404, "Item not found");
          if (!canManagePackingMaster(role, found.rows[0]!.createdBy, userId)) {
            throw new HttpError(403, "Only the packing lead can assign master-list items");
          }
          if (action.assignedUserId) {
            const member = await client.query(
              `SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
              [action.orgId, action.assignedUserId],
            );
            if (!member.rowCount) throw new HttpError(400, "Assignee must be a team member");
          }
          try {
            const updated = await client.query<{ listId: string }>(
              `UPDATE packing_items
               SET assigned_user_id = $3
               WHERE id = $1 AND org_id = $2
               RETURNING list_id AS "listId"`,
              [action.id, action.orgId, action.assignedUserId],
            );
            if (!updated.rowCount) throw new HttpError(404, "Item not found");
            await client.query(`UPDATE packing_lists SET updated_at = now() WHERE id = $1 AND org_id = $2`, [
              updated.rows[0]!.listId,
              action.orgId,
            ]);
            return { ok: true, assignedUserId: action.assignedUserId };
          } catch (error) {
            if (error instanceof HttpError) throw error;
            if (isMissingAssigneeColumn(error)) {
              throw new HttpError(503, "Packing assignees need database migration 0506.");
            }
            throw error;
          }
        }

        case "delete_item": {
          const found = await client.query<{ createdBy: string }>(
            `SELECT l.created_by AS "createdBy"
             FROM packing_items i
             JOIN packing_lists l ON l.id = i.list_id AND l.org_id = i.org_id
             WHERE i.id = $1 AND i.org_id = $2`,
            [action.id, action.orgId],
          );
          if (!found.rowCount) throw new HttpError(404, "Item not found");
          if (!canManagePackingMaster(role, found.rows[0]!.createdBy, userId)) {
            throw new HttpError(403, "Only the packing lead can remove master-list items");
          }
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
