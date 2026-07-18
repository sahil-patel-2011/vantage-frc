"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../../components/ui";

type WaitlistEntry = {
  email: string;
  teamNumber: number;
  phoneE164: string | null;
  launchInvitedAt: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function provisionHref(entry: WaitlistEntry) {
  const params = new URLSearchParams({
    ownerEmail: entry.email,
    teamNumber: String(entry.teamNumber),
  });
  return `/admin?${params.toString()}`;
}

export default function WaitlistAdminClient() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    const params = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
    const response = await fetch(`/api/admin/waitlist${params}`);
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Could not load waitlist.");
      setEntries([]);
    } else {
      setMessage("");
      setEntries(data.entries ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(query);
  }, [load, query]);

  const summary = useMemo(() => {
    const invited = entries.filter((row) => row.launchInvitedAt).length;
    const converted = entries.filter((row) => row.convertedAt).length;
    return { total: entries.length, invited, converted };
  }, [entries]);

  async function mark(action: "mark_invited" | "mark_converted", email: string) {
    setBusyEmail(email);
    setMessage("");
    try {
      const response = await fetch("/api/admin/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, email }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Update failed.");
        return;
      }
      setEntries((current) =>
        current.map((row) => (row.email === email ? (data.entry as WaitlistEntry) : row)),
      );
    } finally {
      setBusyEmail(null);
    }
  }

  return (
    <main className="module-page admin-control">
      <PageHeader
        breadcrumbs="Platform / Waitlist"
        title="Waitlist"
        description="Review launch interest, mark outreach, and jump to team provisioning when you are ready to invite an owner."
      >
        <a className="app-button secondary" href="/admin">
          Team provisioning
        </a>
      </PageHeader>

      <div className="cards">
        <article className="card">
          <span>Showing</span>
          <strong>{loading ? "…" : summary.total}</strong>
        </article>
        <article className="card">
          <span>Launch invited</span>
          <strong>{loading ? "…" : summary.invited}</strong>
        </article>
        <article className="card">
          <span>Converted</span>
          <strong>{loading ? "…" : summary.converted}</strong>
        </article>
      </div>

      <form
        className="admin-waitlist-search"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(search);
        }}
      >
        <label>
          Search email or team number
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="254 or mentor@example.com"
          />
        </label>
        <button type="submit" className="primary-action">
          Search
        </button>
      </form>

      {message ? <p className="auth-message">{message}</p> : null}
      {loading ? <EmptyState soft title="Loading waitlist…" aria-busy /> : null}

      {!loading && entries.length === 0 ? (
        <EmptyState soft title="No waitlist entries match this search" description="Try another email or team number." />
      ) : null}

      {!loading && entries.length > 0 ? (
        <Panel>
          {entries.map((entry) => (
            <article className="admin-org admin-waitlist-row" key={entry.email}>
              <div>
                <strong>{entry.email}</strong>
                <small>
                  Team {entry.teamNumber}
                  {entry.phoneE164 ? ` · ${entry.phoneE164}` : ""}
                  {entry.launchInvitedAt ? " · launch invited" : ""}
                  {entry.convertedAt ? " · converted" : ""}
                </small>
              </div>
              <div className="admin-waitlist-actions">
                <a href={provisionHref(entry)}>Provision team</a>
                <button
                  type="button"
                  disabled={busyEmail === entry.email || !!entry.launchInvitedAt}
                  onClick={() => void mark("mark_invited", entry.email)}
                >
                  Mark invited
                </button>
                <button
                  type="button"
                  disabled={busyEmail === entry.email || !!entry.convertedAt}
                  onClick={() => void mark("mark_converted", entry.email)}
                >
                  Mark converted
                </button>
              </div>
            </article>
          ))}
        </Panel>
      ) : null}
    </main>
  );
}
