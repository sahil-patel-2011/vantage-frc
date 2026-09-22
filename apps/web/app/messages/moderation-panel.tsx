"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, EmptyState } from "../../components/ui";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./moderation.css";

type Report = {
  id: string;
  messageId: string;
  conversationLabel: string;
  reasonLabel: string;
  note: string | null;
  bodySnapshot: string;
  reporterName: string;
  authorName: string;
  messageRemoved: boolean;
  createdAt: string;
};

type State =
  | { kind: "loading" }
  | { kind: "ready"; canModerate: boolean; reports: Report[] }
  | { kind: "error"; message: string };

function when(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/**
 * Open chat reports for a team's owners and admins: read the reported text, then Remove the
 * message (the author sees why) or Dismiss the report. Reports about your own messages never
 * appear here — another owner or admin reviews those (youth protection, migration 0674).
 */
export function ModerationPanel({ orgId }: { orgId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/messages/moderation?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as {
        canModerate?: boolean;
        reports?: Report[];
        error?: string;
      };
      if (!response.ok) {
        setState({ kind: "error", message: body.error ?? "Could not load reports." });
        return;
      }
      setState({ kind: "ready", canModerate: Boolean(body.canModerate), reports: body.reports ?? [] });
    } catch {
      setState({ kind: "error", message: "Could not reach Vantage." });
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(report: Report, action: "remove" | "dismiss") {
    setBusy(report.id);
    setStatus(null);
    try {
      const note = reasons[report.id]?.trim() || null;
      const response = await fetch("/api/messages/moderation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          action === "remove"
            ? { action, orgId, messageId: report.messageId, reason: note ?? report.reasonLabel }
            : { action, orgId, reportId: report.id, note },
        ),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setStatus(
        response.ok
          ? action === "remove"
            ? "Message removed. Everyone sees “Removed by a team admin”; the author sees your reason."
            : "Report dismissed. The message stays."
          : (body.error ?? "That did not go through."),
      );
    } finally {
      setBusy(null);
      await load();
    }
  }

  if (state.kind === "loading") return <p className="app-muted" aria-busy="true">Loading reports…</p>;
  if (state.kind === "error") return <p role="status">{state.message}</p>;
  if (!state.canModerate) {
    return (
      <EmptyState
        soft
        title="Only owners and admins moderate chat"
        description="To flag a message, use Report under it in Chat. Your team's owners and admins will see it."
      />
    );
  }

  return (
    <section className="moderation-panel" aria-label="Open chat reports">
      {status ? (
        <p className="app-muted" role="status">
          {status}
        </p>
      ) : null}
      {state.reports.length === 0 ? (
        <EmptyState soft title="No open reports" description="When a member reports a chat message, it shows up here." />
      ) : (
        <ul className="moderation-list">
          {state.reports.map((report) => (
            <li key={report.id} className="moderation-report">
              <header>
                <Badge tone="setup">{report.reasonLabel}</Badge>
                <span>
                  {report.authorName} in {report.conversationLabel}
                </span>
                {report.messageRemoved ? <Badge tone="neutral">Already removed</Badge> : null}
              </header>
              <blockquote>{report.bodySnapshot}</blockquote>
              <p className="moderation-meta">
                Reported by {report.reporterName} · {when(report.createdAt)}
                {report.note ? ` · “${report.note}”` : ""}
              </p>
              <div className="moderation-actions">
                <label className="sr-only" htmlFor={`mod-reason-${report.id}`}>
                  Reason shown to the author
                </label>
                <input
                  id={`mod-reason-${report.id}`}
                  type="text"
                  maxLength={500}
                  placeholder="Reason (the author sees this if you remove it)"
                  value={reasons[report.id] ?? ""}
                  onChange={(event) => setReasons((current) => ({ ...current, [report.id]: event.target.value }))}
                />
                {!report.messageRemoved ? (
                  <Button variant="danger" type="button" disabled={busy === report.id} onClick={() => void act(report, "remove")}>
                    Remove message
                  </Button>
                ) : null}
                <Button variant="secondary" type="button" disabled={busy === report.id} onClick={() => void act(report, "dismiss")}>
                  Dismiss report
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="app-muted">
        Reports about your own messages go to your team&apos;s other owners and admins, never to you.{" "}
        <a href={withOrgHref("/messages", orgId)}>Back to chat</a>
      </p>
    </section>
  );
}
