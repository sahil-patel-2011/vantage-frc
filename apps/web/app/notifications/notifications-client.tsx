"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, ToolStrip, Button } from "../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import {
  clearFeatureSnapshot,
  getFeatureSnapshot,
  putFeatureSnapshot,
} from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  NOTIFICATION_RELATED_INCLUDE,
  notificationNextActions,
  notificationReadLabel,
  notificationReadTone,
  notificationRelatedLinks,
} from "../../lib/notifications";
import "../product-hub.css";
import "./notifications.css";

type NotifItem = {
  id: string;
  orgId: string | null;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

type InboxFilter = "all" | "unread";

type NotificationsView = {
  status: "ready";
  items: NotifItem[];
  unreadCount: number;
};

function isNotificationsView(value: unknown): value is NotificationsView {
  if (!value || typeof value !== "object") return false;
  const rec = value as { status?: unknown; items?: unknown; unreadCount?: unknown };
  return rec.status === "ready" && Array.isArray(rec.items) && typeof rec.unreadCount === "number";
}

async function persistNotificationsSnapshot(
  orgHint: string,
  filter: InboxFilter,
  data: NotificationsView,
): Promise<void> {
  try {
    await putFeatureSnapshot("notifications", orgHint || "_", data, filter);
    if (!orgHint) await putFeatureSnapshot("notifications", "_", data, filter);
  } catch {
    // Live inbox already painted; IndexedDB is best-effort.
  }
}

function InboxRelated() {
  const links = notificationRelatedLinks({ include: [...NOTIFICATION_RELATED_INCLUDE] });
  return (
    <nav className="product-hub-related notif-related" aria-label="Related account tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function NextActions({
  itemCount,
  unreadCount,
  filter,
}: {
  itemCount: number;
  unreadCount: number;
  filter: InboxFilter;
}) {
  // `mark-read` is dropped, not rendered as a second button: the toolbar above
  // this list already carries "Mark all as read", with the same enabled state
  // and the same effect. The row's own reason is still visible up there as the
  // unread badge.
  const actions = notificationNextActions({ itemCount, unreadCount, filter }).filter(
    (action) => action.id !== "mark-read",
  );
  return (
    <section className="notif-next-actions app-card soft-panel" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function NotificationsClient({ orgId }: { orgId: string | null }) {
  const [view, setView] = useState<NotificationsView | null>(null);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [message, setMessage] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<NotificationsView | null>(null);
  const paintedFilterRef = useRef<InboxFilter>(filter);
  viewRef.current = view;

  const load = useCallback(async () => {
    const orgHint = orgId?.trim() ?? "";
    let hadCache = Boolean(viewRef.current) && paintedFilterRef.current === filter;
    try {
      const cached = await getFeatureSnapshot<NotificationsView>(
        "notifications",
        orgHint || "_",
        filter,
      );
      if (cached?.data && isNotificationsView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        paintedFilterRef.current = filter;
        hadCache = true;
      } else if (paintedFilterRef.current !== filter) {
        setView(null);
        hadCache = false;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setErrorStatus(null);
    try {
      const params = new URLSearchParams({ filter });
      if (orgHint) params.set("orgId", orgHint);
      const response = await fetch(`/api/notifications?${params}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setMessage(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not load notifications.",
        );
        try {
          await clearFeatureSnapshot("notifications", orgHint || "_", filter);
        } catch {
          // Best-effort: painted board already dropped.
        }
        return;
      }
      if (!response.ok) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Notifications. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setMessage(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not load notifications.",
        );
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
      const items =
        data && typeof data === "object" && "items" in data && Array.isArray(data.items)
          ? (data.items as NotifItem[])
          : [];
      const unreadCount =
        data && typeof data === "object" && "unreadCount" in data
          ? Number(data.unreadCount ?? 0)
          : 0;
      const next: NotificationsView = { status: "ready", items, unreadCount };
      setView(next);
      paintedFilterRef.current = filter;
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      await persistNotificationsSnapshot(orgHint, filter, next);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Notifications. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setMessage("Network error loading notifications.");
      setFetchFailed(true);
    }
  }, [filter, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(action: "read" | "unread" | "read_all", id?: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id, orgId }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not update notification.");
        return;
      }
      if (action === "read_all") {
        const unread = view?.unreadCount ?? 0;
        setMessage(
          unread === 1 ? "Marked 1 notification as read." : `Marked ${unread} notifications as read.`,
        );
      } else if (action === "read") {
        setMessage("Marked as read.");
      } else {
        setMessage("Marked as unread.");
      }
      await load();
    } catch {
      setMessage("Network error updating notification.");
    } finally {
      setBusy(false);
    }
  }

  if (!view) {
    const copy = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: message || "Try again, or open Support if the inbox keeps failing.",
          },
        )
      : null;
    return (
      <main className="notif-page module-page">
        <PageHeader
          breadcrumbs="Account / Inbox"
          title="Notifications"
          description="Real alerts for your signed-in account."
        />
        <InboxRelated />
        <OfflineBanner feature="Notifications" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          badge={copy ? "Unavailable" : undefined}
          badgeTone={copy ? "setup" : undefined}
          title={copy ? copy.title : "Loading inbox…"}
          description={copy ? copy.description : "Fetching notifications for your account."}
          aria-busy={!fetchFailed}
        >
          {copy?.primary ? (
            <Button as="a" variant="primary" href={copy.primary.href}>
              {copy.primary.label}
            </Button>
          ) : copy?.showRetry ? (
            <Button variant="primary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  const unreadCount = view.unreadCount;
  const items = view.items;

  return (
    <main className="notif-page module-page">
      <PageHeader
        breadcrumbs="Account / Inbox"
        title="Notifications"
        description="Real alerts for your signed-in account."
      >
        <div className="notif-header-actions">
          {unreadCount >= 1 ? (
            <span className="app-badge">{unreadCount} unread</span>
          ) : (
            <span className="app-badge good">Inbox clear</span>
          )}
        </div>
      </PageHeader>

      <InboxRelated />
      <OfflineBanner feature="Notifications" fromCache={fromCache} cachedAt={cachedAt} />

      {message ? (
        <p className="telemetry-status" role="status">
          {message}
        </p>
      ) : null}

      <div className="notif-toolbar">
        <ToolStrip
          aria-label="Inbox filters"
          value={filter}
          onChange={(id) => setFilter(id as InboxFilter)}
          visibleCount={4}
          items={[
            { id: "all", label: "All" },
            { id: "unread", label: "Unread" },
          ]}
        />
        <div className="notif-toolbar-actions">
          <Button
            variant="secondary"
            type="button"
            disabled={busy || unreadCount < 1}
            onClick={() => void patch("read_all")}
          >
            Mark all as read
          </Button>
        </div>
      </div>

      <NextActions itemCount={items.length} unreadCount={unreadCount} filter={filter} />

      {items.length === 0 ? (
        <EmptyState
          soft
          badge="Empty"
          badgeTone="good"
          title={filter === "unread" ? "No unread notifications" : "No notifications yet"}
          description={
            filter === "unread"
              ? "You’re caught up. Switch to All for history, or wait for the next real todo, duty, calendar, or release alert."
              : "When a coach assigns a todo or duty, schedules a calendar event, a release ships, or teammates message you, they appear here with a real timestamp."
          }
        />
      ) : (
        <ul className="notif-list" id="notif-inbox-list" aria-label="Inbox">
          {items.map((item) => {
            const unread = !item.readAt;
            const readTone = notificationReadTone(item.readAt);
            return (
              <li key={item.id} className={unread ? "unread" : undefined}>
                <header>
                  <div>
                    <strong>{item.title}</strong>
                    <small>
                      {item.type.replaceAll("_", " ")} · {new Date(item.createdAt).toLocaleString()}
                    </small>
                  </div>
                  <span className={`app-badge${readTone ? ` ${readTone}` : ""}`}>
                    {notificationReadLabel(item.readAt)}
                  </span>
                </header>
                {item.body ? <p>{item.body}</p> : null}
                <footer>
                  {item.href ? (
                    <Button as="a" variant="primary" href={item.href}>
                      Open
                    </Button>
                  ) : null}
                  {unread ? (
                    <Button
                      variant="secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => void patch("read", item.id)}
                    >
                      Mark as read
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => void patch("unread", item.id)}
                    >
                      Mark as unread
                    </Button>
                  )}
                </footer>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
