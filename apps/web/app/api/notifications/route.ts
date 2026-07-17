import { notificationBody, notificationHref, notificationTitle } from "../../../lib/notifications";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

type NotificationRow = {
  id: string;
  orgId: string | null;
  type: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

function fail(error: unknown, status = 400) {
  return Response.json(
    { error: error instanceof Error ? error.message : "Notification request failed" },
    { status },
  );
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return fail(new Error("Authentication required"), 401);

    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const filter = url.searchParams.get("filter") === "unread" ? "unread" : "all";
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 40) || 40));

    const data = await withRls({ userId: session.user.id, orgId: orgId ?? undefined }, async (client) => {
      const rows = await client.query<NotificationRow>(
        `SELECT id, org_id AS "orgId", type, payload,
                read_at::text AS "readAt", created_at::text AS "createdAt"
         FROM notifications
         WHERE user_id = $1
           AND ($2::uuid IS NULL OR org_id IS NULL OR org_id = $2::uuid)
           AND ($3::text = 'all' OR read_at IS NULL)
         ORDER BY created_at DESC
         LIMIT $4`,
        [session.user.id, orgId, filter, limit],
      );

      const unread = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM notifications
         WHERE user_id = $1 AND read_at IS NULL
           AND ($2::uuid IS NULL OR org_id IS NULL OR org_id = $2::uuid)`,
        [session.user.id, orgId],
      );

      return {
        unreadCount: Number(unread.rows[0]?.count ?? 0),
        items: rows.rows.map((row) => {
          const payload = row.payload ?? {};
          return {
            id: row.id,
            orgId: row.orgId,
            type: row.type,
            title: notificationTitle(row.type, payload),
            body: notificationBody(payload),
            href: notificationHref(row.type, payload, row.orgId ?? orgId),
            payload,
            readAt: row.readAt,
            createdAt: row.createdAt,
          };
        }),
      };
    });

    return Response.json(data);
  } catch (error) {
    return fail(error, error instanceof Error && error.message.includes("Authentication") ? 401 : 400);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return fail(new Error("Authentication required"), 401);

    const body = (await request.json()) as {
      orgId?: string | null;
      id?: string;
      action?: "read" | "unread" | "read_all";
    };
    const action = body.action ?? "read";
    const orgId = body.orgId ?? null;

    const result = await withRls({ userId: session.user.id, orgId: orgId ?? undefined }, async (client) => {
      if (action === "read_all") {
        const updated = await client.query(
          `UPDATE notifications SET read_at = coalesce(read_at, now())
           WHERE user_id = $1 AND read_at IS NULL
             AND ($2::uuid IS NULL OR org_id IS NULL OR org_id = $2::uuid)`,
          [session.user.id, orgId],
        );
        return { ok: true, updated: updated.rowCount ?? 0 };
      }

      if (!body.id) throw new Error("id is required");
      const readAt = action === "unread" ? null : new Date().toISOString();
      const updated = await client.query(
        `UPDATE notifications
         SET read_at = $3::timestamptz
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [body.id, session.user.id, readAt],
      );
      if (!updated.rowCount) throw new Error("Notification not found");
      return { ok: true, id: body.id, readAt };
    });

    return Response.json(result);
  } catch (error) {
    return fail(error, error instanceof Error && error.message.includes("Authentication") ? 401 : 400);
  }
}
