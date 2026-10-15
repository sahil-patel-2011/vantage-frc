import type { PoolClient } from "@neondatabase/serverless";
import { LIVE_NOTIFICATION_SQL } from "./live-sql";

/**
 * The personal/team scope, with the team given by a SQL expression (a constant written here,
 * never user input): `$2::uuid` for a team the request names, `scope.org_id` for the active team
 * the list query resolves itself.
 */
function inboxScopeSql(orgExpr: string): string {
  return `notifications.user_id = $1
  AND (${orgExpr} IS NULL OR notifications.org_id IS NULL OR notifications.org_id = ${orgExpr})
  AND ${LIVE_NOTIFICATION_SQL}`;
}

/** The badge, list and read actions use the same personal/team scope. */
export const INBOX_SCOPE_SQL = inboxScopeSql("$2::uuid");

/**
 * The person's default team, chosen exactly as /api/me chooses it with no team in the address
 * (owner, then admin, then the rest; lowest team number; name). The inbox opened without
 * ?orgId used to wait for /api/me to answer this before it could ask for its list.
 */
export const INBOX_ACTIVE_ORG_SQL = `SELECT m.org_id
  FROM memberships m
  JOIN organizations o ON o.id = m.org_id
  WHERE m.user_id = $1
  ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number NULLS LAST, o.name
  LIMIT 1`;

/** The newest rows the inbox shows at once; older ones load by keyset ("Show older"). */
export const INBOX_PAGE_SIZE = 40;

export type InboxCursor = { before: string; beforeId: string };

const PG_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:\d{2})?|Z)?$/;

/** Where the next page starts: the last row's exact created_at text and its id. */
export function parseInboxCursor(before: string | null, beforeId: string | null): InboxCursor | null {
  if (!before && !beforeId) return null;
  if (!before || !beforeId || !PG_TIMESTAMP.test(before) || !UUID.test(beforeId)) throw new Error("Invalid page");
  return { before, beforeId };
}

type InboxPageRow = {
  scopeOrgId: string | null;
  unreadCount: number | string | null;
  id: string | null;
  orgId: string | null;
  type: string | null;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string | null;
};

export type InboxPageItem = {
  id: string;
  orgId: string | null;
  type: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

export type InboxPage = {
  /** The team the list is scoped to: the resolved active team when the request asked for it. */
  orgId: string | null;
  unreadCount: number;
  rows: InboxPageItem[];
  nextCursor: InboxCursor | null;
};

/**
 * The inbox in one statement: the scope (resolving the active team when asked), one pass over
 * this person's rows for both the page and the unread count (two scans of a table with no
 * user_id index, in two round trips, before), the newest `limit` rows after the cursor, and the
 * full row (payload) only for the rows on the page.
 */
export async function loadInboxPage(
  client: InboxClient,
  input: {
    userId: string;
    orgId: string | null;
    active: boolean;
    filter: "all" | "unread";
    limit: number;
    cursor: InboxCursor | null;
  },
): Promise<InboxPage> {
  const result = await client.query<InboxPageRow>(
    `WITH scope AS (
       SELECT CASE WHEN $3::boolean THEN (${INBOX_ACTIVE_ORG_SQL}) ELSE $2::uuid END AS org_id
     ),
     scoped AS (
       SELECT notifications.id, notifications.read_at, notifications.created_at
       FROM notifications CROSS JOIN scope
       WHERE ${inboxScopeSql("scope.org_id")}
     ),
     page AS (
       SELECT id, created_at FROM scoped
       WHERE ($4::text = 'all' OR read_at IS NULL)
         AND ($6::timestamptz IS NULL OR (created_at, id) < ($6::timestamptz, $7::uuid))
       ORDER BY created_at DESC, id DESC
       LIMIT $5
     )
     SELECT scope.org_id AS "scopeOrgId",
            (SELECT count(*)::int FROM scoped WHERE read_at IS NULL) AS "unreadCount",
            n.id, n.org_id AS "orgId", n.type, n.payload,
            n.read_at::text AS "readAt", n.created_at::text AS "createdAt"
     FROM scope
     LEFT JOIN page ON true
     LEFT JOIN notifications n ON n.id = page.id
     ORDER BY page.created_at DESC NULLS LAST, page.id DESC`,
    [
      input.userId,
      input.active ? null : input.orgId,
      input.active,
      input.filter,
      input.limit + 1,
      input.cursor?.before ?? null,
      input.cursor?.beforeId ?? null,
    ],
  );
  const first = result.rows[0];
  const rows: InboxPageItem[] = [];
  for (const row of result.rows) {
    if (!row.id || !row.type || !row.createdAt) continue;
    rows.push({ id: row.id, orgId: row.orgId, type: row.type, payload: row.payload ?? {}, readAt: row.readAt, createdAt: row.createdAt });
  }
  const more = rows.length > input.limit;
  const shown = more ? rows.slice(0, input.limit) : rows;
  const last = shown[shown.length - 1];
  return {
    orgId: first?.scopeOrgId ?? null,
    unreadCount: Number(first?.unreadCount ?? 0),
    rows: shown,
    nextCursor: more && last ? { before: last.createdAt, beforeId: last.id } : null,
  };
}

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
