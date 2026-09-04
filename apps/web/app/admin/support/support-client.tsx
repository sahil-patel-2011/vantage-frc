"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../../components/ui";
import {
  SUPPORT_TICKET_STATUSES,
  statusLabel,
  type SupportTicketAdminRow,
  type SupportTicketStatus,
} from "../../../lib/support-tickets";
import "../admin-flow.css";

export default function AdminSupportClient() {
  const [tickets, setTickets] = useState<SupportTicketAdminRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<SupportTicketStatus | "">("open");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { status: SupportTicketStatus; response: string }>>({});

  const load = useCallback(async (status: SupportTicketStatus | "", q: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (q.trim()) params.set("q", q.trim());
    const response = await fetch(`/api/admin/support${params.toString() ? `?${params}` : ""}`);
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Could not load tickets.");
      setTickets([]);
    } else {
      setMessage("");
      const next = (data.tickets ?? []) as SupportTicketAdminRow[];
      setTickets(next);
      setDrafts((current) => {
        const merged = { ...current };
        for (const ticket of next) {
          if (!merged[ticket.id]) {
            merged[ticket.id] = {
              status: ticket.status,
              response: ticket.adminResponse ?? "",
            };
          }
        }
        return merged;
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(statusFilter, query);
  }, [load, statusFilter, query]);

  const summary = useMemo(() => {
    const open = tickets.filter((row) => row.status === "open").length;
    const inProgress = tickets.filter((row) => row.status === "in_progress").length;
    return { total: tickets.length, open, inProgress };
  }, [tickets]);

  async function save(ticketId: string) {
    const draft = drafts[ticketId];
    if (!draft) return;
    setBusyId(ticketId);
    setMessage("");
    try {
      const response = await fetch("/api/admin/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticketId,
          status: draft.status,
          adminResponse: draft.response.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Update failed.");
        return;
      }
      const updated = data.ticket as SupportTicketAdminRow;
      setTickets((current) => current.map((row) => (row.id === ticketId ? updated : row)));
      setDrafts((current) => ({
        ...current,
        [ticketId]: {
          status: updated.status,
          response: updated.adminResponse ?? "",
        },
      }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="module-page admin-control">
      <PageHeader
        breadcrumbs="Platform / Support"
        title="Support tickets"
        description="Triage member-reported breakage. Replies show on the submitter’s Soft-UI Support page. Empty until real tickets exist — never DEMO triage rows."
      />

      <div className="cards">
        <article className="card">
          <span>Showing</span>
          <strong>{loading ? "…" : summary.total}</strong>
        </article>
        <article className="card">
          <span>Open in view</span>
          <strong>{loading ? "…" : summary.open}</strong>
        </article>
        <article className="card">
          <span>In progress</span>
          <strong>{loading ? "…" : summary.inProgress}</strong>
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
          Status
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as SupportTicketStatus | "")}
          >
            <option value="">All</option>
            {SUPPORT_TICKET_STATUSES.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="subject, email, team…"
          />
        </label>
        <button type="submit" className="primary-action">
          Search
        </button>
      </form>

      {message ? <p className="auth-message">{message}</p> : null}
      {loading ? <EmptyState soft title="Loading tickets…" aria-busy /> : null}

      {!loading && tickets.length === 0 ? (
        <EmptyState soft title="No tickets match" description="Try another status or search." />
      ) : null}

      {!loading && tickets.length > 0 ? (
        <Panel>
          {tickets.map((ticket) => {
            const draft = drafts[ticket.id] ?? {
              status: ticket.status,
              response: ticket.adminResponse ?? "",
            };
            return (
              <article className="admin-org admin-support-row" key={ticket.id}>
                <div>
                  <strong>{ticket.subject}</strong>
                  <small>
                    {ticket.teamNumber != null ? `Team ${ticket.teamNumber}` : ticket.orgName ?? "Org"}
                    {ticket.submitterEmail ? ` · ${ticket.submitterEmail}` : ""}
                    {ticket.submitterName ? ` · ${ticket.submitterName}` : ""}
                    {` · ${new Date(ticket.createdAt).toLocaleString()}`}
                  </small>
                  <p className="admin-support-body">{ticket.body}</p>
                </div>
                <div className="admin-support-actions">
                  <label>
                    Status
                    <select
                      value={draft.status}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [ticket.id]: {
                            ...draft,
                            status: event.target.value as SupportTicketStatus,
                          },
                        }))
                      }
                    >
                      {SUPPORT_TICKET_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {statusLabel(status)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Reply
                    <textarea
                      rows={3}
                      value={draft.response}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [ticket.id]: { ...draft, response: event.target.value },
                        }))
                      }
                      placeholder="Optional reply visible to the submitter"
                    />
                  </label>
                  <button
                    type="button"
                    className="primary-action"
                    disabled={busyId === ticket.id}
                    onClick={() => void save(ticket.id)}
                  >
                    {busyId === ticket.id ? "Saving…" : "Save"}
                  </button>
                </div>
              </article>
            );
          })}
        </Panel>
      ) : null}
    </main>
  );
}
