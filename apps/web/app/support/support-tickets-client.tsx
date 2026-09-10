"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  SUPPORT_RELATED_INCLUDE,
  statusLabel,
  summarizeSupportTickets,
  supportNextActions,
  supportRelatedLinks,
  supportStatusTone,
  ticketAwaitsReply,
  type SupportTicket,
  type SupportTicketMemberView,
} from "../../lib/support-tickets";
import "../product-hub.css";

function SupportRelated({ orgId }: { orgId?: string | null }) {
  const links = supportRelatedLinks(orgId, { include: [...SUPPORT_RELATED_INCLUDE] });
  return (
    <nav className="product-hub-related support-tickets-related" aria-label="Related account tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function NextActions({
  orgId,
  ticketCount,
  awaitingReply,
}: {
  orgId?: string | null;
  ticketCount: number;
  awaitingReply: number;
}) {
  const actions = supportNextActions({ orgId, ticketCount, awaitingReply });
  return (
    <section className="support-tickets-next-actions app-card soft-panel" aria-label="Next actions">
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

export default function SupportTicketsClient() {
  const [view, setView] = useState<SupportTicketMemberView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(() => {
    setError("");
    setErrorStatus(null);
    setFetchFailed(false);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
    void fetch(`/api/tickets${query}`)
      .then(async (response) => {
        const data = (await response.json()) as SupportTicketMemberView & { error?: string };
        if (!response.ok) {
          setFetchFailed(true);
          setErrorStatus(response.status);
          setError(data.error ?? "Could not load tickets");
          return;
        }
        setView(data);
      })
      .catch(() => {
        setFetchFailed(true);
        setError("Network error — please try again.");
      });
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

  if (fetchFailed || view == null) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error,
          },
        )
      : null;
    return (
      <main className="module-page support-tickets-page">
        <PageHeader
          navPath="/support"
          title="Support"
          description="Tell the Vantage platform owner when something breaks."
        />
        <EmptyState
          soft
          title={failure ? failure.title : "Loading support…"}
          description={failure ? failure.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page support-tickets-page">
        <PageHeader
          navPath="/support"
          title="Support"
          description="Platform tickets need an active team. Legacy /help redirects here."
        />
        <SupportRelated orgId={view.orgId} />
        <NextActions orgId={view.orgId} ticketCount={0} awaitingReply={0} />
        <EmptyState
          soft
          badge="Setup required"
          badgeTone="setup"
          title={view.message ?? "Choose your team first."}
          description="Choose the organization you need help for, then return here to submit a real ticket."
        >
          <div className="support-tickets-header-actions">
            <Button as="a" variant="primary" href="/workspace">
              Choose your team
            </Button>
            <Button as="a" variant="secondary" href="/account">
              Account
            </Button>
          </div>
        </EmptyState>
      </main>
    );
  }

  const summary = summarizeSupportTickets(view.tickets);
  const workspaceLabel =
    view.teamNumber != null
      ? `Team ${view.teamNumber}${view.orgName ? ` · ${view.orgName}` : ""}`
      : view.orgName
        ? view.orgName
        : "your team";

  return (
    <main className="module-page support-tickets-page">
      <PageHeader
        navPath="/support"
        title="Support"
        description="Tell the Vantage platform owner when something breaks. You’ll see your tickets and any reply here. Legacy /help redirects here."
      >
        <div className="support-tickets-header-actions">
          <Button as="a" variant="secondary" href="/account">
            Account
          </Button>
          <Button as="a" variant="secondary" href="/account?tab=notifications">
            Notification prefs
          </Button>
        </div>
      </PageHeader>

      <SupportRelated orgId={view.orgId} />

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

      <NextActions
        orgId={view.orgId}
        ticketCount={summary.total}
        awaitingReply={summary.awaitingReply}
      />

      <section className="soft-panel support-tickets-form-panel" id="support-new-ticket">
        <h2>New ticket</h2>
        <p className="app-muted">
          Sending from {workspaceLabel}. Platform admins triage these — not your team chat. The list below only
          shows tickets you submit.
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

      <section className="soft-panel" id="support-ticket-list" aria-labelledby="support-ticket-list-title">
        <header className="support-tickets-list-header">
          <div>
            <h2 id="support-ticket-list-title">Your tickets</h2>
            <p className="app-muted">
              {summary.total === 0
                ? "No tickets yet — nothing is pre-filled."
                : [
                    `${summary.total} total`,
                    summary.awaitingReply > 0 ? `${summary.awaitingReply} awaiting reply` : null,
                    summary.open + summary.inProgress > 0
                      ? `${summary.open + summary.inProgress} open`
                      : null,
                    summary.resolved > 0 ? `${summary.resolved} resolved` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </p>
          </div>
        </header>
        {view.tickets.length === 0 ? (
          <EmptyState
            soft
            title="No tickets yet"
            description="Submit one above when something needs platform attention."
          />
        ) : (
          <ul className="support-tickets-list">
            {view.tickets.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function TicketCard({ ticket }: { ticket: SupportTicket }) {
  const awaiting = ticketAwaitsReply(ticket);
  const tone = supportStatusTone(ticket.status);
  return (
    <li className={`support-ticket-card${awaiting ? " awaits-reply" : ""}`}>
      <header>
        <strong>{ticket.subject}</strong>
        <span className={`app-badge ${tone} support-ticket-status status-${ticket.status}`}>
          {statusLabel(ticket.status)}
        </span>
      </header>
      <div className="support-ticket-meta">
        <span>Submitted {new Date(ticket.createdAt).toLocaleString()}</span>
        <span className={awaiting ? "awaiting" : "settled"}>
          {awaiting
            ? "Awaiting platform reply"
            : ticket.adminResponse
              ? "Platform replied"
              : ticket.status === "closed"
                ? "Closed"
                : "Updated"}
        </span>
      </div>
      <p>{ticket.body}</p>
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
