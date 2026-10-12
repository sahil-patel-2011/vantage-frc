"use client";

import { useEffect, useState } from "react";
import { relativeTime } from "../../components/ui";

type ContactsView = { count: number | null; refreshedAt: string | null; stale: boolean; sharedStore: boolean };

/**
 * "Outage contact list: N people, refreshed X ago — Refresh now". The outage console emails
 * this list while the database is down; it refreshes on its own every 12 hours while a platform
 * admin is signed in, and this line shows it is there.
 */
export function OutageContactsLine() {
  const [view, setView] = useState<ContactsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/outage-contacts", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<ContactsView>) : null))
      .then((body) => {
        if (!cancelled && body) setView(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/admin/outage-contacts", { method: "POST" }).catch(() => null);
    const body = response ? ((await response.json().catch(() => null)) as (ContactsView & { error?: string }) | null) : null;
    setBusy(false);
    if (!response?.ok || !body || body.error) {
      setError(body?.error ?? "Couldn't refresh it. Try again.");
      return;
    }
    setView(body);
  }

  if (!view) return null;
  const summary =
    view.count == null || !view.refreshedAt
      ? "not saved yet"
      : `${view.count} ${view.count === 1 ? "person" : "people"}, refreshed ${relativeTime(view.refreshedAt)}`;

  // Under the team list, not above "Create a team": it is checked now and then, and the setup
  // note below used to push the form down by about 150px (QA A2-19). Operators may read env names.
  return (
    <div className="admin-outage-contacts app-muted" role="status">
      <span>Outage contact list: {summary}</span>
      <button type="button" className="admin-outage-contacts-refresh" onClick={() => void refresh()} disabled={busy}>
        {busy ? "Refreshing…" : "Refresh now"}
      </button>
      {view.sharedStore ? null : (
        <small>Kept on this server only, so it may be gone during an outage. Set OUTAGE_REDIS_URL and OUTAGE_REDIS_TOKEN to keep it.</small>
      )}
      {error ? <small role="alert">{error}</small> : null}
    </div>
  );
}
