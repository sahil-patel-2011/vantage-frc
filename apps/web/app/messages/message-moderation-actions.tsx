"use client";

import { useId, useState } from "react";
import { REPORT_REASONS, type ReportReason } from "../../lib/messages/moderation-copy";

export type ModerationMode = "idle" | "report" | "remove";

type Props = {
  orgId: string;
  messageId: string;
  /** Which form is open. The per-message "…" menu owns this so the forms open from its items. */
  mode: ModerationMode;
  onModeChange: (mode: ModerationMode) => void;
  /** Re-read the thread after a removal. */
  onChanged: () => void;
};

/**
 * The Report and Remove forms for one team chat message, plus the receipt line after either is
 * sent. The buttons that open them live in the message's "…" menu (message-actions-menu.tsx):
 * any member can report someone else's message; owners and admins can remove any message with a
 * reason. The server checks the role again either way.
 */
export function MessageModerationActions({ orgId, messageId, mode, onModeChange, onChanged }: Props) {
  const setMode = onModeChange;
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
                  // The form opens from the "…" menu, which closes as it opens this. Focus has
                  // to land somewhere inside, or a keyboard user is left on a vanished item.
                  autoFocus={reason === option.id}
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
              autoFocus
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
