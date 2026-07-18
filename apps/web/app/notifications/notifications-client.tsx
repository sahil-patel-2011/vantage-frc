"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, TabBar } from "../../components/ui";

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
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ filter });
    if (orgId) params.set("orgId", orgId);
    const response = await fetch(`/api/notifications?${params}`);
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Could not load notifications.");
      setItems([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }
    setItems(data.items ?? []);
    setUnreadCount(Number(data.unreadCount ?? 0));
    setMessage("");
    setLoading(false);
  }, [filter, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(action: "read" | "unread" | "read_all", id?: string) {
    setBusy(true);
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, id, orgId }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error ?? "Could not update notification.");
      return;
    }
    await load();
  }

  return (
    <main className="notif-page module-page">
      <PageHeader
        breadcrumbs="Account / Inbox"
        title="Notifications"
        description={
          <>
            Real alerts for your signed-in account. Empty means nothing has been sent yet — Vantage does not invent
            competition notices.
          </>
        }
      >
        {unreadCount >= 1 ? (
          <span className="app-badge">{unreadCount} unread</span>
        ) : (
          <span className="app-badge good">Inbox clear</span>
        )}
      </PageHeader>

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
        <button type="button" disabled={busy || unreadCount < 1} onClick={() => void patch("read_all")}>
          Mark all read
        </button>
        <a href="/notifications/preferences">Which events notify</a>
        <a href="/account?tab=notifications">Account prefs</a>
        <a href="/security">Security</a>
      </TabBar>

      {message ? (
        <p className="telemetry-status" role="status">
          {message}
        </p>
      ) : null}

      {loading ? (
        <EmptyState soft title="Loading inbox…" description="Fetching notifications for your account." aria-busy />
      ) : items.length === 0 ? (
        <EmptyState
          soft
          badge="Empty"
          badgeTone="good"
          title={filter === "unread" ? "No unread notifications" : "No notifications yet"}
          description="When a coach assigns a todo or duty, schedules a calendar event, exports finish, or teammates message you, they appear here with a real timestamp — never as placeholder competition noise."
        >
          <div className="settings-inline-links">
            <a className="app-button secondary" href="/notifications/preferences">
              Which events notify
            </a>
            <a className="app-button secondary" href="/account?tab=notifications">
              Account prefs
            </a>
            <a className="app-button secondary" href="/security">
              Security
            </a>
          </div>
        </EmptyState>
      ) : (
        <ul className="notif-list">
          {items.map((item) => (
            <li key={item.id} className={item.readAt ? undefined : "unread"}>
              <header>
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.type.replaceAll("_", " ")} · {new Date(item.createdAt).toLocaleString()}
                    {item.readAt ? " · read" : " · new"}
                  </small>
                </div>
                {!item.readAt ? <span className="app-badge">New</span> : null}
              </header>
              {item.body ? <p>{item.body}</p> : null}
              <footer>
                {item.href ? (
                  <a className="primary" href={item.href}>
                    Open
                  </a>
                ) : null}
                {item.readAt ? (
                  <button type="button" disabled={busy} onClick={() => void patch("unread", item.id)}>
                    Mark unread
                  </button>
                ) : (
                  <button type="button" disabled={busy} onClick={() => void patch("read", item.id)}>
                    Mark read
                  </button>
                )}
              </footer>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
