import { notificationBody, notificationHref, notificationTitle } from "../../../lib/notifications";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { publicErrorMessage } from "../../../lib/security/public-error";
import { INBOX_SCOPE_SQL, parseInboxAction, unreadNotificationCount, updateInboxReadState } from "../../../lib/notifications/inbox-store";
import { joinerNames, nameTheJoiner } from "../../../lib/notifications/joiner-names";

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
    { error: publicErrorMessage(error, "Notification request failed") },
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
         WHERE ${INBOX_SCOPE_SQL}
           AND ($3::text = 'all' OR read_at IS NULL)
         ORDER BY created_at DESC
         LIMIT $4`,
        [session.user.id, orgId, filter, limit],
      );

      const unreadCount = await unreadNotificationCount(client, session.user.id, orgId);

      const joinerIds = rows.rows
        .filter((row) => row.type === "invite_accepted" && typeof row.payload?.userId === "string")
        .map((row) => String(row.payload.userId));
      const joiners = await joinerNames(client, [...new Set(joinerIds)]);

      return {
        userId: session.user.id,
        orgId,
        unreadCount,
        items: rows.rows.map((row) => {
          const payload = row.payload ?? {};
          const title = notificationTitle(row.type, payload);
          return {
            id: row.id,
            orgId: row.orgId,
            type: row.type,
            title:
              row.type === "invite_accepted" && typeof payload.userId === "string"
                ? nameTheJoiner(title, joiners.get(String(payload.userId)))
                : title,
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
      action?: unknown;
      ids?: unknown;
    };
    const { action, ids } = parseInboxAction(body);
    const orgId = body.orgId ?? null;

    const result = await withRls({ userId: session.user.id, orgId: orgId ?? undefined }, async (client) => {
      return { ...(await updateInboxReadState(client, session.user.id, orgId, action, ids)), userId: session.user.id, orgId };
    });

    return Response.json(result);
  } catch (error) {
    return fail(error, error instanceof Error && error.message.includes("Authentication") ? 401 : 400);
  }
}
