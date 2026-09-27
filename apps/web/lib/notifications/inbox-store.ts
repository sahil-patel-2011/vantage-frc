import type { PoolClient } from "@neondatabase/serverless";
import { LIVE_NOTIFICATION_SQL } from "./live-sql";

/** The badge, list and read actions use the same personal/team scope. */
export const INBOX_SCOPE_SQL = `notifications.user_id = $1
  AND ($2::uuid IS NULL OR notifications.org_id IS NULL OR notifications.org_id = $2::uuid)
  AND ${LIVE_NOTIFICATION_SQL}`;

type InboxClient = Pick<PoolClient, "query">;
export async function unreadNotificationCount(client: InboxClient, userId: string, orgId: string | null) {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM notifications WHERE ${INBOX_SCOPE_SQL} AND read_at IS NULL`, [userId, orgId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export type InboxAction = "read" | "unread" | "read_all" | "read_visible";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseInboxAction(body: { action?: unknown; id?: unknown; ids?: unknown }) {
  const action = body.action ?? "read";
  if (!["read", "unread", "read_all", "read_visible"].includes(String(action))) throw new Error("Unknown notification action");
  let ids: string[] = [];
  if (action === "read_visible" || (action !== "read_all" && body.ids !== undefined)) {
    if (body.id !== undefined) throw new Error("Provide a single ID or a batch, not both");
    if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 100) throw new Error("Provide 1 to 100 visible notification IDs");
    if (!body.ids.every(id => typeof id === "string" && UUID.test(id))) throw new Error("Invalid notification ID");
    ids = [...new Set(body.ids)] as string[];
  } else if (action !== "read_all") {
    if (typeof body.id !== "string" || !UUID.test(body.id)) throw new Error("A valid notification ID is required");
    ids = [body.id];
  }
  return { action: action as InboxAction, ids };
}

export async function updateInboxReadState(client: InboxClient, userId: string, orgId: string | null, action: InboxAction, ids: string[]) {
  const result = await client.query<{ id: string; readAt: string | null }>(
    `UPDATE notifications SET read_at = ${action === "unread" ? "NULL" : "coalesce(read_at, now())"}
     WHERE ${INBOX_SCOPE_SQL} AND ($3::boolean OR id = ANY($4::uuid[]))
     RETURNING id, read_at::text AS "readAt"`, [userId, orgId, action === "read_all", ids],
  );
  if ((action === "read" || action === "unread") && result.rowCount !== ids.length) throw new Error("Notification not found");
  return { ok: true, updated: result.rowCount ?? 0, items: result.rows,
    unreadCount: await unreadNotificationCount(client, userId, orgId) };
}
