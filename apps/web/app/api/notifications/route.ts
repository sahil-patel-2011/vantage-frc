import { notificationBody, notificationHref, notificationTitle } from "../../../lib/notifications";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { publicErrorMessage } from "../../../lib/security/public-error";
import { INBOX_PAGE_SIZE, loadInboxPage, parseInboxAction, parseInboxCursor, unreadNotificationCount, updateInboxReadState } from "../../../lib/notifications/inbox-store";
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
    // `scope=active` without a team: the server picks the person's default team itself (as
    // /api/me does), so the inbox does not wait for /api/me before asking for its list.
    const active = !orgId && url.searchParams.get("scope") === "active";
    const filter = url.searchParams.get("filter") === "unread" ? "unread" : "all";
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? INBOX_PAGE_SIZE) || INBOX_PAGE_SIZE));
    const cursor = parseInboxCursor(url.searchParams.get("before"), url.searchParams.get("beforeId"));

    const data = await withRls({ userId: session.user.id, orgId: orgId ?? undefined }, async (client) => {
      if (url.searchParams.get("mode") === "count") return {
        userId: session.user.id, orgId, unreadCount: await unreadNotificationCount(client, session.user.id, orgId),
      };
      // One statement: the page, the unread count and (for scope=active) the team.
      const page = await loadInboxPage(client, { userId: session.user.id, orgId, active, filter, limit, cursor });
      const rows: NotificationRow[] = page.rows;
      const scopeOrgId = active ? page.orgId : orgId;

      const joinerIds = rows
        .filter((row) => row.type === "invite_accepted" && typeof row.payload?.userId === "string")
        .map((row) => String(row.payload.userId));
      const joiners = await joinerNames(client, [...new Set(joinerIds)]);

      return {
        userId: session.user.id,
        orgId: scopeOrgId,
        unreadCount: page.unreadCount,
        nextCursor: page.nextCursor,
        // Only what the inbox draws: the payload stays on the server.
        items: rows.map((row) => {
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
            body: notificationBody(payload, row.type),
            href: notificationHref(row.type, payload, row.orgId ?? scopeOrgId),
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
