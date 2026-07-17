"use client";

import { useCallback, useEffect, useState } from "react";

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
      <header className="app-page-header">
        <div>
          <p className="breadcrumbs">Account / Inbox</p>
          <h1>Notifications</h1>
          <p>
            Real alerts for your signed-in account. Empty means nothing has been sent yet — Vantage does not invent
            competition notices.
          </p>
        </div>
        {unreadCount >= 1 ? <span className="app-badge">{unreadCount} unread</span> : <span className="app-badge good">Inbox clear</span>}
      </header>

      <div className="notif-toolbar" role="toolbar" aria-label="Inbox filters">
        <button type="button" className={filter === "all" ? "primary" : undefined} onClick={() => setFilter("all")}>
          All
        </button>
        <button
          type="button"
          className={filter === "unread" ? "primary" : undefined}
          onClick={() => setFilter("unread")}
        >
          Unread
        </button>
        <button type="button" disabled={busy || unreadCount < 1} onClick={() => void patch("read_all")}>
          Mark all read
        </button>
        <a href="/account?tab=notifications">Preferences</a>
      </div>

      {message ? (
        <p className="telemetry-status" role="status">
          {message}
        </p>
      ) : null}

      {loading ? (
        <div className="notif-empty" aria-busy="true">
          <strong>Loading inbox…</strong>
          <p>Fetching notifications for your account.</p>
        </div>
      ) : items.length === 0 ? (
        <div className="notif-empty">
          <span className="app-badge good">Empty</span>
          <strong>{filter === "unread" ? "No unread notifications" : "No notifications yet"}</strong>
          <p>
            When exports finish, teammates message you, or billing/sync events fire, they appear here with a real
            timestamp — never as placeholder competition noise.
          </p>
          <a className="app-button secondary" href="/account?tab=notifications">
            Manage preferences
          </a>
        </div>
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
