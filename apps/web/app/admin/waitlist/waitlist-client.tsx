"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../../components/ui";
import { adminProvisionHref, adminRelatedLinks } from "../../../lib/admin";
import "../admin-flow.css";

/** What `publicSignupStatus()` reports, straight from the admin route. */
type SignupStatus = {
  open: boolean;
  earliest: string;
  dateReached: boolean;
  envEnabled: boolean;
  reason: string;
};

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
  return adminProvisionHref({ ownerEmail: entry.email, teamNumber: entry.teamNumber });
}

export default function WaitlistAdminClient() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [signup, setSignup] = useState<SignupStatus | null>(null);
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
    // Sent on the 503 too: a deployment with no waitlist store still has a
    // door, and this is the screen that says whether it is open.
    setSignup((data.signup as SignupStatus | undefined) ?? null);
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
        description="Review launch interest, mark outreach, and jump to team provisioning when you are ready to invite an owner. Real entries only."
      >
        <nav className="settings-inline-links admin-related" aria-label="Platform shortcuts">
          {adminRelatedLinks({
            active: "waitlist",
            include: ["teams", "plans", "support", "releases"],
          }).map((link) => (
            <a key={link.id} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      </PageHeader>

      {/*
        The doors, above the queue.

        Turning off the waitlist is two conditions that both have to hold, and
        until now neither of them was visible anywhere in the product — you
        read the source to learn there were two, then opened the hosting
        dashboard to find out about the second. This says which one is
        outstanding and the exact thing to do about it, so "turn off the
        waitlist" is one known step rather than a small research project.
      */}
      {signup ? (
        <section
          className="admin-signup-doors"
          data-open={signup.open ? "yes" : "no"}
          aria-label="Public sign-up"
        >
          <div>
            <span className="admin-signup-state">
              {signup.open ? "Open to everyone" : "Invite-only"}
            </span>
            <p>{signup.reason}</p>
          </div>
          <ol className="admin-signup-steps">
            <li data-done={signup.dateReached ? "yes" : "no"}>
              {signup.dateReached
                ? `Planned date reached (${signup.earliest})`
                : `Waiting for ${signup.earliest}`}
            </li>
            <li data-done={signup.envEnabled ? "yes" : "no"}>
              {signup.envEnabled
                ? "VANTAGE_PUBLIC_SIGNUP=open is set"
                : "Set VANTAGE_PUBLIC_SIGNUP=open on the deployment, then redeploy"}
            </li>
          </ol>
        </section>
      ) : null}

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
