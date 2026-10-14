"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, PageHeader, Panel, ToolStrip } from "../../../components/ui";
import {
  ADMIN_FEEDBACK_NEW_EVENT,
  FEEDBACK_LIST_LIMIT,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  formatScreenSize,
  isFeedbackStatus,
  type FeedbackCounts,
  type FeedbackItem,
  type FeedbackStatus,
} from "../../../lib/feedback/admin-feedback";
import type { BugKind } from "../../../lib/feedback/bug-report";
import "../admin-flow.css";
import "./feedback.css";

type KindFilter = "all" | BugKind;
type StatusFilter = "all" | FeedbackStatus;

const KIND_WORD: Record<BugKind, string> = { bug: "Problem", idea: "Idea" };

function announceNewCount(count: number) {
  window.dispatchEvent(new CustomEvent(ADMIN_FEEDBACK_NEW_EVENT, { detail: { count } }));
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AdminFeedbackClient() {
  // The inbox opens on what is waiting; "Any status" is one tap away.
  const [kind, setKind] = useState<KindFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("new");
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [counts, setCounts] = useState<FeedbackCounts | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; status: FeedbackStatus } | null>(null);
  const latest = useRef(0);

  const load = useCallback(async (nextKind: KindFilter, nextStatus: StatusFilter) => {
    const request = ++latest.current;
    setLoading(true);
    const params = new URLSearchParams();
    if (nextKind !== "all") params.set("kind", nextKind);
    if (nextStatus !== "all") params.set("status", nextStatus);
    try {
      const query = params.toString();
      const response = await fetch(`/api/admin/feedback${query ? `?${query}` : ""}`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as {
        items?: FeedbackItem[];
        hasMore?: boolean;
        counts?: FeedbackCounts;
        error?: string;
      };
      if (request !== latest.current) return;
      if (!response.ok || !data.items || !data.counts) {
        setMessage(data.error ?? "Could not load feedback.");
        setItems([]);
        return;
      }
      setMessage("");
      setItems(data.items);
      setHasMore(Boolean(data.hasMore));
      setCounts(data.counts);
      announceNewCount(data.counts.newTotal);
    } catch {
      if (request !== latest.current) return;
      setMessage("Could not reach the server. Check your connection and try again.");
      setItems([]);
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(kind, status);
  }, [load, kind, status]);

  async function changeStatus(item: FeedbackItem, next: FeedbackStatus) {
    if (next === item.status || busyId) return;
    setBusyId(item.id);
    setMessage("");
    setSaved(null);
    try {
      const response = await fetch("/api/admin/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, status: next }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        status?: FeedbackStatus;
        counts?: FeedbackCounts;
        error?: string;
      };
      if (!response.ok || !data.status) {
        setMessage(data.error ?? "Could not change the status.");
        return;
      }
      const confirmed = data.status;
      // The row stays where it is until the next load, so a slip of the finger can be put right.
      setItems((current) => current.map((row) => (row.id === item.id ? { ...row, status: confirmed } : row)));
      setSaved({ id: item.id, status: confirmed });
      if (data.counts) {
        setCounts(data.counts);
        announceNewCount(data.counts.newTotal);
      }
    } catch {
      setMessage("Could not reach the server. The status was not changed.");
    } finally {
      setBusyId(null);
    }
  }

  const kindItems = [
    { id: "all", label: counts ? `All ${counts.total}` : "All" },
    { id: "bug", label: counts ? `Problems ${counts.byKind.bug}` : "Problems" },
    { id: "idea", label: counts ? `Ideas ${counts.byKind.idea}` : "Ideas" },
  ];

  return (
    <main className="module-page admin-control">
      <PageHeader
        breadcrumbs="Platform / Feedback"
        title="Feedback"
        description="Problems and ideas people send from the feedback button, newest first. They go to the Vantage team, not to the sender's own team."
      />

      <div className="cards">
        <article className="card">
          <span>New</span>
          <strong>{counts ? counts.newTotal : "…"}</strong>
        </article>
        <article className="card">
          <span>Problems</span>
          <strong>{counts ? counts.byKind.bug : "…"}</strong>
        </article>
        <article className="card">
          <span>Ideas</span>
          <strong>{counts ? counts.byKind.idea : "…"}</strong>
        </article>
      </div>

      <div className="fb-admin-filters">
        <ToolStrip
          aria-label="Kind of feedback"
          presentation="segments"
          value={kind}
          onChange={(next) => setKind(next as KindFilter)}
          items={kindItems}
        />
        <label className="fb-admin-status-filter">
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value === "all" ? "all" : (event.target.value as FeedbackStatus))}
          >
            <option value="all">Any status</option>
            {FEEDBACK_STATUSES.map((value) => (
              <option key={value} value={value}>
                {FEEDBACK_STATUS_LABELS[value]}
                {counts ? ` (${counts.byStatus[value]})` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {message ? (
        <p className="auth-message" role="alert">
          {message}
        </p>
      ) : null}
      {loading && items.length === 0 ? <EmptyState soft title="Loading feedback…" aria-busy /> : null}

      {!loading && !message && items.length === 0 ? (
        counts && counts.total === 0 ? (
          <EmptyState
            soft
            title="No feedback yet"
            description="Notes sent from the feedback button show up here as soon as someone sends one."
          />
        ) : (
          <EmptyState
            soft
            title={status === "new" ? "Nothing new" : "No notes match"}
            description={
              status === "new"
                ? "Every note has been looked at. Choose Any status to see the older ones."
                : "Try another status, or switch the kind back to All."
            }
          />
        )
      ) : null}

      {items.length > 0 ? (
        <Panel aria-busy={loading || undefined}>
          {items.map((item) => {
            const screen = formatScreenSize(item.viewportWidth, item.viewportHeight);
            const team =
              item.teamNumber != null
                ? `Team ${item.teamNumber}${item.orgName ? ` · ${item.orgName}` : ""}`
                : (item.orgName ?? "No team");
            return (
              <article className="admin-org admin-support-row fb-admin-row" key={item.id} data-kind={item.kind}>
                <div>
                  <p className="fb-admin-head">
                    <span className="fb-admin-kind" data-kind={item.kind}>
                      {KIND_WORD[item.kind]}
                    </span>
                    <strong>{item.reporterName?.trim() || "Unnamed member"}</strong>
                    {item.reporterEmail ? <a href={`mailto:${item.reporterEmail}`}>{item.reporterEmail}</a> : null}
                  </p>
                  <p className="admin-support-body">{item.description}</p>
                  <dl className="fb-admin-meta">
                    <div>
                      <dt>Team</dt>
                      <dd>{team}</dd>
                    </div>
                    <div>
                      <dt>Page</dt>
                      <dd>{item.route ? <code>{item.route}</code> : "Not captured"}</dd>
                    </div>
                    <div>
                      <dt>Screen</dt>
                      <dd>{screen ?? "Not captured"}</dd>
                    </div>
                    <div>
                      <dt>Sent</dt>
                      <dd>
                        <time dateTime={item.createdAt}>{when(item.createdAt)}</time>
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="admin-support-actions fb-admin-actions">
                  <label>
                    Status
                    <select
                      value={item.status}
                      disabled={busyId === item.id}
                      onChange={(event) => {
                        if (isFeedbackStatus(event.target.value)) void changeStatus(item, event.target.value);
                      }}
                    >
                      {FEEDBACK_STATUSES.map((value) => (
                        <option key={value} value={value}>
                          {FEEDBACK_STATUS_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <small className="fb-admin-saved" role="status">
                    {busyId === item.id
                      ? "Saving…"
                      : saved?.id === item.id
                        ? `Marked ${FEEDBACK_STATUS_LABELS[saved.status].toLowerCase()}`
                        : ""}
                  </small>
                </div>
              </article>
            );
          })}
        </Panel>
      ) : null}

      {hasMore ? (
        <p className="app-muted">
          Showing the newest {FEEDBACK_LIST_LIMIT}. Pick a kind or a status to narrow the list.
        </p>
      ) : null}
    </main>
  );
}
