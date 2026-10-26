import { loadNotificationsInbox } from "../api/notifications/route";
import { INBOX_PAGE_SIZE, parseInboxCursor } from "../../lib/notifications/inbox-store";
import { withPagePaint } from "../../lib/page-org";
import NotificationsClient from "./notifications-client";

export const metadata = {
  title: "Notifications",
};

export const dynamic = "force-dynamic";

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  const view = await withPagePaint("/notifications", orgId, async ({ client, userId, orgId: resolved }) => {
    const inbox = await loadNotificationsInbox(client, {
      userId,
      orgId: orgId ?? null,
      active: !orgId,
      filter: "all",
      limit: INBOX_PAGE_SIZE,
      cursor: parseInboxCursor(null, null),
    });
    return {
      status: "ready" as const,
      userId: inbox.userId,
      items: inbox.items,
      unreadCount: inbox.unreadCount,
      nextCursor: inbox.nextCursor,
      orgId: inbox.orgId ?? resolved,
    };
  });
  return <NotificationsClient orgId={view?.orgId ?? orgId ?? null} initial={view} />;
}
