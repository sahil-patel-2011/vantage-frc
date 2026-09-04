"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, TabBar } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { notificationReadLabel, notificationReadTone } from "../../lib/notifications";
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

export default function NotificationsClient({ orgId }: { orgId: string | null }) {
  const [items, setItems] = useState<NotifItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchFailed(false);
    setErrorStatus(null);
    try {
      const params = new URLSearchParams({ filter });
      if (orgId) params.set("orgId", orgId);
      const response = await fetch(`/api/notifications?${params}`);
      const data = (await response.json()) as {
        items?: NotifItem[];
        unreadCount?: number;
        error?: string;
      };
      if (!response.ok) {
        setMessage(data.error ?? "Could not load notifications.");
        setErrorStatus(response.status);
        setItems([]);
        setUnreadCount(0);
        setFetchFailed(true);
        return;
      }
      // Real notifications rows only — never invent DEMO inbox items client-side.
      setItems(Array.isArray(data.items) ? data.items : []);
      setUnreadCount(Number(data.unreadCount ?? 0));
      setMessage("");
    } catch {
      setMessage("Network error loading notifications.");
      setItems([]);
      setUnreadCount(0);
      setFetchFailed(true);
    } finally {
      setLoading(false);
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
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not update notification.");
        return;
      }
      if (action === "read_all") {
        setMessage(
          unreadCount === 1 ? "Marked 1 notification as read." : `Marked ${unreadCount} notifications as read.`,
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

  return (
    <main className="notif-page module-page">
      <PageHeader
        breadcrumbs="Account / Inbox"
        title="Notifications"
        description="Real alerts for your signed-in account. Empty means nothing has been sent yet — Vantage never invents DEMO competition notices."
      >
        <div className="notif-header-actions">
          {unreadCount >= 1 ? (
            <span className="app-badge">{unreadCount} unread</span>
          ) : (
            <span className="app-badge good">Inbox clear</span>
          )}
          <a className="app-button secondary" href="/notifications/preferences">
            Preferences
          </a>
        </div>
      </PageHeader>

      {message ? (
        <p className="telemetry-status" role="status">
          {message}
        </p>
      ) : null}

      {loading ? (
        <EmptyState soft title="Loading inbox…" description="Fetching notifications for your account." aria-busy />
      ) : fetchFailed ? (
        (() => {
          const copy = loadFailureCopy(
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
              message:
                message ||
                "Try again, or open Support if the inbox keeps failing. Nothing was filled with DEMO notifications.",
            },
          );
          return (
          <>
            <EmptyState
              soft
              badge="Unavailable"
              badgeTone="setup"
              title={copy.title}
              description={copy.description}
            >
              <div className="notif-empty-actions">
                {copy.primary ? (
                  <a className="app-button" href={copy.primary.href}>
                    {copy.primary.label}
                  </a>
                ) : null}
                {copy.showRetry ? (
                  <button type="button" className="app-button" onClick={() => void load()}>
                    Retry
                  </button>
                ) : null}
                <a className="app-button secondary" href="/support">
                  Help & Support
                </a>
              </div>
            </EmptyState>
          </>
          );
        })()
      ) : (
        <>
          <TabBar
            variant="toolbar"
            aria-label="Inbox filters"
            value={filter}
            onChange={(id) => setFilter(id as "all" | "unread")}
            tabs={[
              { id: "all", label: "All" },
              { id: "unread", label: "Unread" },
            ]}
          >
            <div className="notif-toolbar-actions">
              <button
                type="button"
                className="app-button secondary"
                disabled={busy || unreadCount < 1}
                onClick={() => void patch("read_all")}
              >
                Mark all as read
              </button>
            </div>
          </TabBar>

          {items.length === 0 ? (
            <EmptyState
              soft
              badge="Empty"
              badgeTone="good"
              title={filter === "unread" ? "No unread notifications" : "No notifications yet"}
              description={
                filter === "unread"
                  ? "You’re caught up. Switch to All for history, or wait for the next real todo, duty, calendar, or release alert — never DEMO fillers."
                  : "When a coach assigns a todo or duty, schedules a calendar event, a release ships, or teammates message you, they appear here with a real timestamp — never DEMO competition noise."
              }
            >
              <div className="notif-empty-actions">
                <a className="app-button secondary" href="/notifications/preferences">
                  Preferences
                </a>
              </div>
            </EmptyState>
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
                        <a className="app-button" href={item.href}>
                          Open
                        </a>
                      ) : null}
                      {unread ? (
                        <button
                          type="button"
                          className="app-button secondary"
                          disabled={busy}
                          onClick={() => void patch("read", item.id)}
                        >
                          Mark as read
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="app-button secondary"
                          disabled={busy}
                          onClick={() => void patch("unread", item.id)}
                        >
                          Mark as unread
                        </button>
                      )}
                    </footer>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
