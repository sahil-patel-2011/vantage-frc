"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "../../components/ui/page-header";
import { statusLabel, type SupportTicket, type SupportTicketMemberView } from "../../lib/support-tickets";

export default function SupportTicketsClient() {
  const [view, setView] = useState<SupportTicketMemberView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(() => {
    setError("");
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
    void fetch(`/api/tickets${query}`)
      .then(async (response) => {
        const data = (await response.json()) as SupportTicketMemberView & { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Could not load tickets");
          return;
        }
        setView(data);
      })
      .catch(() => setError("Network error — please try again."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!view?.orgId || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: view.orgId, subject, body }),
      });
      const data = (await response.json()) as SupportTicketMemberView & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not submit ticket");
        return;
      }
      setView(data);
      setSubject("");
      setBody("");
      setMessage("Ticket sent. We’ll follow up here when there’s a reply.");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="module-page support-tickets-page">
      <PageHeader
        navPath="/support"
        title="Support"
        description="Tell the Vantage platform owner when something breaks. You’ll see your tickets and any reply here."
      />

      {error ? (
        <p className="support-tickets-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="support-tickets-ok" role="status">
          {message}
        </p>
      ) : null}

      {!view ? (
        <section className="soft-panel">
          <p className="app-muted">Loading…</p>
        </section>
      ) : view.status === "setup_required" ? (
        <section className="soft-panel">
          <h2>Workspace needed</h2>
          <p>{view.message ?? "Select a team workspace first."}</p>
          <a className="app-button" href="/workspace">
            Open workspace
          </a>
        </section>
      ) : (
        <>
          <section className="soft-panel support-tickets-form-panel">
            <h2>New ticket</h2>
            <p className="app-muted">
              {view.teamNumber != null
                ? `Sending from Team ${view.teamNumber}${view.orgName ? ` · ${view.orgName}` : ""}.`
                : view.orgName
                  ? `Sending from ${view.orgName}.`
                  : "Sending from your active workspace."}{" "}
              Platform admins triage these — not your team chat.
            </p>
            <form className="support-tickets-form" onSubmit={(event) => void onSubmit(event)}>
              <label>
                Subject
                <input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  maxLength={200}
                  required
                  placeholder="e.g. Scouting save fails on match page"
                />
              </label>
              <label>
                What broke?
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  maxLength={8000}
                  rows={6}
                  required
                  placeholder="What you were doing, what you expected, and what happened instead. Include the URL if you can."
                />
              </label>
              <button className="primary-action" type="submit" disabled={busy || !subject.trim() || !body.trim()}>
                {busy ? "Sending…" : "Submit ticket"}
              </button>
            </form>
          </section>

          <section className="soft-panel">
            <h2>Your tickets</h2>
            {view.tickets.length === 0 ? (
              <p className="app-muted">No tickets yet. Submit one above when something needs platform attention.</p>
            ) : (
              <ul className="support-tickets-list">
                {view.tickets.map((ticket) => (
                  <TicketCard key={ticket.id} ticket={ticket} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function TicketCard({ ticket }: { ticket: SupportTicket }) {
  return (
    <li className="support-ticket-card">
      <header>
        <strong>{ticket.subject}</strong>
        <span className={`support-ticket-status status-${ticket.status}`}>{statusLabel(ticket.status)}</span>
      </header>
      <p>{ticket.body}</p>
      <small>Submitted {new Date(ticket.createdAt).toLocaleString()}</small>
      {ticket.adminResponse ? (
        <div className="support-ticket-reply">
          <strong>Platform reply</strong>
          <p>{ticket.adminResponse}</p>
          {ticket.respondedAt ? (
            <small>Updated {new Date(ticket.respondedAt).toLocaleString()}</small>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
