"use client";

import { useId, useState } from "react";
import { REPORT_REASONS, type ReportReason } from "../../lib/messages/moderation-copy";
import { withOrgHref } from "../../lib/nav/product-nav";

type Props = {
  orgId: string;
  messageId: string;
  mine: boolean;
  /** Owner/admin — the same role check the server makes again. */
  canModerate: boolean;
  /** Re-read the thread after a removal. */
  onChanged: () => void;
};

type Mode = "idle" | "report" | "remove";

/**
 * Per-message moderation in team chat: any member can Report someone else's message; owners and
 * admins can Remove any message (with a reason) and jump to the moderation panel.
 */
export function MessageModerationActions({ orgId, messageId, mine, canModerate, onChanged }: Props) {
  const [mode, setMode] = useState<Mode>("idle");
  const [reason, setReason] = useState<ReportReason>("harassment");
  const [note, setNote] = useState("");
  const [removeReason, setRemoveReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const formId = useId();

  async function post(payload: Record<string, unknown>) {
    const response = await fetch("/api/messages/moderation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, messageId, ...payload }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      receipt?: string;
      alreadyReported?: boolean;
    };
    if (!response.ok) throw new Error(body.error ?? "That did not go through.");
    return body;
  }

  async function submitReport(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = await post({ action: "report", reason, note });
      setStatus(body.alreadyReported ? "You already reported this message." : (body.receipt ?? "Reported."));
      setMode("idle");
      setNote("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not report that message.");
    } finally {
      setBusy(false);
    }
  }

  async function submitRemove(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await post({ action: "remove", reason: removeReason });
      setStatus("Removed. Everyone now sees “Removed by a team admin”.");
      setMode("idle");
      setRemoveReason("");
      onChanged();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not remove that message.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!mine ? (
        <button
          type="button"
          className="message-report"
          aria-expanded={mode === "report"}
          aria-controls={`${formId}-report`}
          onClick={() => setMode(mode === "report" ? "idle" : "report")}
        >
          Report
        </button>
      ) : null}
      {canModerate && !mine ? (
        <button
          type="button"
          className="message-remove"
          aria-expanded={mode === "remove"}
          aria-controls={`${formId}-remove`}
          onClick={() => setMode(mode === "remove" ? "idle" : "remove")}
        >
          Remove
        </button>
      ) : null}
      {canModerate ? (
        <a className="message-moderation-link" href={withOrgHref("/messages/moderation", orgId)}>
          Moderation
        </a>
      ) : null}

      {mode === "report" ? (
        <form id={`${formId}-report`} className="message-moderation-form" onSubmit={submitReport}>
          <fieldset>
            <legend>Why are you reporting this?</legend>
            {REPORT_REASONS.map((option) => (
              <label key={option.id}>
                <input
                  type="radio"
                  name={`${formId}-reason`}
                  value={option.id}
                  checked={reason === option.id}
                  onChange={() => setReason(option.id)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <label>
            Anything else? (optional)
            <textarea value={note} maxLength={1000} rows={2} onChange={(event) => setNote(event.target.value)} />
          </label>
          <p className="message-moderation-hint">
            Your team’s owners and admins see the report and the message. The person who wrote it does not see who
            reported it.
          </p>
          <div className="message-moderation-buttons">
            <button type="submit" className="app-button primary" disabled={busy}>
              {busy ? "Sending…" : "Send report"}
            </button>
            <button type="button" className="app-button secondary" onClick={() => setMode("idle")}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {mode === "remove" ? (
        <form id={`${formId}-remove`} className="message-moderation-form" onSubmit={submitRemove}>
          <label>
            Reason (the author sees this)
            <input
              type="text"
              value={removeReason}
              maxLength={500}
              onChange={(event) => setRemoveReason(event.target.value)}
              placeholder="e.g. Not OK for a youth team"
            />
          </label>
          <div className="message-moderation-buttons">
            <button type="submit" className="app-button danger" disabled={busy}>
              {busy ? "Removing…" : "Remove message"}
            </button>
            <button type="button" className="app-button secondary" onClick={() => setMode("idle")}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {status ? (
        <p className="message-moderation-status" role="status">
          {status}
        </p>
      ) : null}
    </>
  );
}

/** What renders in place of a message a team admin removed. */
export function RemovedMessageNotice({ notice, when }: { notice: string; when: string }) {
  return (
    <article className="deleted removed-by-admin">
      <span>removed · {when}</span>
      <p>
        <em>{notice}</em>
      </p>
    </article>
  );
}
