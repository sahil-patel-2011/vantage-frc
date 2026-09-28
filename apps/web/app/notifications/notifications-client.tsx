"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, ToolStrip, Button } from "../../components/ui";
import { FEATURE_API_TIMEOUT_MS, fetchActiveOrgId, persistOrgIdInUrl } from "../../lib/nav/resolve-org";
import { listenInboxUpdates, ownInboxUpdate, publishInboxUpdate } from "../../lib/notifications/inbox-events";
import {
  clearFeatureSnapshot,
  getFeatureSnapshot,
  putFeatureSnapshot,
} from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  NOTIFICATION_RELATED_INCLUDE,
  notificationRelatedLinks,
  notificationTypeLabel,
} from "../../lib/notifications";
import "../product-hub.css";
import "./notifications.css";
import { inboxText, inboxWhen } from "../../lib/notifications/inbox-words";

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
  userId?: string;
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
        <a key={link.href} href={link.href}>{link.label}</a>
      ))}
    </nav>
  );
}

export default function NotificationsClient({ orgId }: { orgId: string | null }) {
  const [scopeOrgId, setScopeOrgId] = useState(orgId);
  const [scopeReady, setScopeReady] = useState(Boolean(orgId));
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
  const listRef = useRef<HTMLUListElement>(null);
  const seenIds = useRef(new Set<string>());
  const loadGeneration = useRef(0);
  const scopeKey = `${scopeOrgId ?? "_"}:${filter}`;
  const currentScope = useRef(scopeKey);
  const paintedScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  viewRef.current = view;

  useEffect(() => {
    let cancelled = false;
    seenIds.current.clear();
    if (orgId) { setScopeOrgId(orgId); setScopeReady(true); return; }
    void fetchActiveOrgId().then(id => {
      if (cancelled) return;
      setScopeOrgId(id);
      if (id) persistOrgIdInUrl(id);
    }).catch(() => {
      if (!cancelled) setMessage("Could not select your team. Retry or select a team from your account menu.");
    }).finally(() => { if (!cancelled) setScopeReady(true); });
    return () => { cancelled = true; };
  }, [orgId]);

  const load = useCallback(async () => {
    if (!scopeReady) return;
    const orgHint = scopeOrgId?.trim() ?? "";
    const key = `${scopeOrgId ?? "_"}:${filter}`;
    if (currentScope.current !== key) return;
    const generation = ++loadGeneration.current;
    const stale = () => loadGeneration.current !== generation || currentScope.current !== key;
    let hadCache = Boolean(viewRef.current) && paintedScope.current === key;
    if (paintedScope.current !== key) { setView(null); viewRef.current = null; }
    try {
      const cached = await getFeatureSnapshot<NotificationsView>(
        "notifications",
        orgHint || "_",
        filter,
      );
      if (stale()) return;
      if (cached?.data && isNotificationsView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        paintedScope.current = key;
        hadCache = true;
      } else if (paintedScope.current !== key) {
        setView(null);
        hadCache = false;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    if (stale()) return;
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
      if (stale()) return;
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
        if (hadCache || (viewRef.current && paintedScope.current === key)) {
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
      if (!data || typeof data !== "object" || !("items" in data) || !Array.isArray(data.items)
        || !("unreadCount" in data) || typeof data.unreadCount !== "number"
        || !Number.isSafeInteger(data.unreadCount) || data.unreadCount < 0
        || !("userId" in data) || typeof data.userId !== "string" || !data.userId) {
        throw new Error("The inbox returned an incomplete response. Retry to load notifications.");
      }
      const items = data.items as NotifItem[];
      const unreadCount = data.unreadCount;
      const userId = data.userId;
      const next: NotificationsView = { status: "ready", userId, items, unreadCount };
      setView(next);
      paintedScope.current = key;
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      if (userId) publishInboxUpdate({ userId, orgId: scopeOrgId, unreadCount });
      await persistNotificationsSnapshot(orgHint, filter, next);
    } catch {
      if (stale()) return;
      if (hadCache || (viewRef.current && paintedScope.current === key)) {
        setFromCache(true);
        setMessage("Could not refresh Notifications. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setMessage("Network error loading notifications.");
      setFetchFailed(true);
    }
  }, [filter, scopeOrgId, scopeReady]);
  const refreshInbox = useRef(load);
  refreshInbox.current = load;

  useEffect(() => {
    void load();
    return () => { loadGeneration.current += 1; };
  }, [load]);

  useEffect(() => listenInboxUpdates(data => {
    if (data.mutation && data.userId === viewRef.current?.userId && !ownInboxUpdate(data)) void refreshInbox.current();
  }), []);

  // Opening the inbox acknowledges rows actually seen. Unseen, off-screen,
  // offline and failed reads remain unread; history is retained.
  useEffect(() => {
    if (!view?.userId || fromCache || !listRef.current || typeof IntersectionObserver === "undefined") return;
    const userId = view.userId;
    const groups = groupRepeats(view.items);
    let stopped = false;
    const visible = new Set<string>();
    let flushing = false;
    const flush = async () => {
      if (flushing || stopped || document.visibilityState !== "visible" || visible.size === 0) return;
      const ids = [...visible].filter(id => !seenIds.current.has(id)).slice(0, 100);
      if (!ids.length) return;
      flushing = true;
      ids.forEach(id => seenIds.current.add(id));
      try {
        const response = await fetch("/api/notifications", {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "read_visible", ids, orgId: scopeOrgId }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not acknowledge notifications");
        publishInboxUpdate({ userId, orgId: scopeOrgId, unreadCount: data.unreadCount, mutation: true });
        if (stopped) { void refreshInbox.current(); return; }
        const read = new Map<string, string>(data.items.map((item: { id: string; readAt: string }) => [item.id, item.readAt]));
        const current = viewRef.current;
        if (current?.userId !== userId) return;
        const next = { ...current, unreadCount: data.unreadCount,
          items: current.items.map(item => read.has(item.id) ? { ...item, readAt: read.get(item.id)! } : item)
            .filter(item => filter !== "unread" || !item.readAt) };
        setView(next);
        await persistNotificationsSnapshot(scopeOrgId || "_", filter, next);
      } catch {
        ids.forEach(id => seenIds.current.delete(id));
        if (!stopped) setMessage("Could not mark these notifications as read. Your unread count is preserved; use Mark all as read to retry.");
      } finally { flushing = false; }
    };
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.notificationId;
        const group = groups.find(group => group.item.id === id);
        if (!group) continue;
        for (const item of [group.item, ...group.repeats]) {
          if (entry.isIntersecting && entry.intersectionRatio >= .6 && !item.readAt) visible.add(item.id);
          else visible.delete(item.id);
        }
      }
      void flush();
    }, { threshold: [.6], rootMargin: "0px 0px -88px 0px" });
    listRef.current.querySelectorAll("[data-notification-id]").forEach(row => observer.observe(row));
    const onVisibility = () => { void flush(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stopped = true; observer.disconnect(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [view, fromCache, scopeOrgId, filter]);

  async function patch(action: "read" | "unread" | "read_all", id?: string, ids?: string[]) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id, ids, orgId: scopeOrgId }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as { error?: string; userId: string; unreadCount: number };
      if (!response.ok) {
        setMessage(data.error ?? "Could not update notification.");
        return;
      }
      if (action === "unread") for (const one of ids ?? (id ? [id] : [])) seenIds.current.add(one);
      publishInboxUpdate({ userId: data.userId, orgId: scopeOrgId, unreadCount: data.unreadCount, mutation: true });
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
          description="Todos, duties, chat, and team news for your signed-in account."
        >
          <InboxRelated />
        </PageHeader>
        <OfflineBanner feature="Notifications" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          badge={copy ? "Unavailable" : undefined}
          badgeTone={copy ? "setup" : undefined}
          title={copy ? copy.title : "Loading inbox…"}
          description={copy ? copy.description : "Loading your inbox."}
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
        description="Todos, duties, chat, and team news for your signed-in account."
      >
        <div className="notif-header-actions">
          {unreadCount >= 1 ? <span className="app-badge">{unreadCount} unread</span> : null}
        </div>
        <InboxRelated />
      </PageHeader>

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
        {unreadCount >= 1 ? (
          <div className="notif-toolbar-actions">
            <Button variant="secondary" type="button" disabled={busy} onClick={() => void patch("read_all")}>
              Mark all as read
            </Button>
          </div>
        ) : null}
      </div>

      {items.length === 0 ? (
        <EmptyState
          soft
          title={filter === "unread" ? "No unread notifications" : "No notifications yet"}
          description={
            filter === "unread"
              ? "You’re caught up. Switch to All for history, or wait for the next todo, duty, calendar, or release alert."
              : "When a coach assigns a todo or duty, schedules a calendar event, a release ships, or teammates message you, they appear here."
          }
        >
          {filter === "unread" ? (
            <Button variant="primary" type="button" onClick={() => setFilter("all")}>
              Show all
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <ul ref={listRef} className="notif-list" id="notif-inbox-list" aria-label="Inbox">
          {/* Compact rows, and repeats folded: the same card arriving minutes apart used to fill a
              phone screen two at a time (Open + Mark as read on every ~165px card). */}
          {groupRepeats(items).map(({ item, repeats }) => {
            const unread = !item.readAt;
            const titleText = inboxText(item.title);
            const title = item.href ? <a href={item.href}>{titleText}</a> : titleText;
            return (
              <li key={item.id} data-notification-id={item.id} className={unread ? "unread" : undefined}>
                <div className="notif-row-main">
                  <strong>{title}</strong>
                  {item.body ? <p>{inboxText(item.body)}</p> : null}
                  <small>
                    {notificationTypeLabel(item.type)} · {inboxWhen(item.createdAt)}
                    {repeats.length ? ` · ${repeats.length} more like this` : ""}
                  </small>
                </div>
                <button
                  type="button"
                  className="notif-row-toggle"
                  disabled={busy}
                  aria-label={unread ? `Mark "${item.title}" as read` : `Mark "${item.title}" as unread`}
                  onClick={() => void patch(unread ? "read" : "unread", undefined, [item, ...repeats].map(one => one.id))}
                >
                  {unread ? "Mark read" : "Mark unread"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

/** Consecutive notifications with the same kind and title fold into the first one. */
function groupRepeats<T extends { type: string; title: string; body?: string | null; href?: string | null; readAt: string | null }>(
  items: T[],
): Array<{ item: T; repeats: T[] }> {
  const groups: Array<{ item: T; repeats: T[] }> = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.item.type === item.type && last.item.title === item.title && last.item.body === item.body && last.item.href === item.href && Boolean(last.item.readAt) === Boolean(item.readAt)) {
      last.repeats.push(item);
    } else {
      groups.push({ item, repeats: [] });
    }
  }
  return groups;
}
