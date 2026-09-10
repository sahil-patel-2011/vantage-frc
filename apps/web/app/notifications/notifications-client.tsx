"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, ToolStrip, Button } from "../../components/ui";
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
  filter: "all" | "unread";
}) {
  // `mark-read` is dropped, not rendered as a second button: the toolbar above
  // this list already carries "Mark all as read", with the same enabled state
  // and the same effect. The row's own reason is still visible up there as the
  // unread badge.
  const actions = notificationNextActions({ itemCount, unreadCount, filter })
    .filter((action) => action.id !== "mark-read");
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
        description="Real alerts for your signed-in account."
      >
        {/* Prefs and Account used to be repeated here, one line above the
            related strip that already carries both — and the two "Account"
            buttons pointed at different URLs (/account vs
            /account?tab=notifications), so the same word meant two places on
            one screen. The strip below is the single copy. */}
        <div className="notif-header-actions">
          {unreadCount >= 1 ? (
            <span className="app-badge">{unreadCount} unread</span>
          ) : (
            <span className="app-badge good">Inbox clear</span>
          )}
        </div>
      </PageHeader>

      <InboxRelated />

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
                "Try again, or open Support if the inbox keeps failing.",
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
                  <Button as="a" variant="primary" href={copy.primary.href}>
                    {copy.primary.label}
                  </Button>
                ) : null}
                {copy.showRetry ? (
                  <Button variant="primary" type="button" onClick={() => void load()}>
                    Retry
                  </Button>
                ) : null}
                <Button as="a" variant="secondary" href="/support">
                  Help & Support
                </Button>
              </div>
            </EmptyState>
            <NextActions itemCount={0} unreadCount={0} filter={filter} />
          </>
          );
        })()
      ) : (
        <>
          <div className="notif-toolbar">
            <ToolStrip
              aria-label="Inbox filters"
              value={filter}
              onChange={(id) => setFilter(id as "all" | "unread")}
              visibleCount={4}
              items={[
                { id: "all", label: "All" },
                { id: "unread", label: "Unread" },
              ]}
            />
            <div className="notif-toolbar-actions">
              <Button variant="secondary" type="button" disabled={busy || unreadCount < 1} onClick={() => void patch("read_all")}>
                Mark all as read
              </Button>
            </div>
          </div>

          <NextActions itemCount={items.length} unreadCount={unreadCount} filter={filter} />

          {/* This empty state carries no action row: it repeated the related
              strip at the top of the page verbatim — prefs, What's new,
              Support, Account — and the Next actions list directly above
              already links all four with the reason for each. Three copies of
              the same four buttons on one screen is not three chances to
              click, it is noise. */}
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
                        <Button variant="secondary" type="button" disabled={busy} onClick={() => void patch("read", item.id)}>
                          Mark as read
                        </Button>
                      ) : (
                        <Button variant="secondary" type="button" disabled={busy} onClick={() => void patch("unread", item.id)}>
                          Mark as unread
                        </Button>
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
