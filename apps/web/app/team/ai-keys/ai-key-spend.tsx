"use client";

import { useId, useState } from "react";
import { describeKeySpend, limitResetsOn, type KeySpend } from "./ai-key-spend-model";

/*
  This month's spend on one AI key, a bar against its limit, and the limit itself.

  Shown on every team key and every personal key. Whoever may edit the key may set its limit:
  a member on their own personal keys, a key manager on the team's. "Unlimited" clears it.
*/

export function KeySpendMeter({
  orgId,
  keyId,
  scope,
  label,
  spend,
  canEdit,
  onSaved,
  onMessage,
}: {
  orgId: string;
  keyId: string;
  scope: "team" | "member";
  label: string;
  spend: KeySpend;
  canEdit: boolean;
  onSaved: () => Promise<void> | void;
  onMessage: (message: string, isError?: boolean) => void;
}) {
  const id = useId();
  const view = describeKeySpend(spend);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setDraft(view.limit === null ? "" : String(view.limit));
    setError(null);
    setEditing(true);
  }

  async function save(limit: number | null) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/organizations/ai-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "update_key", keyId, scope, monthlyLimitUsd: limit }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "That limit was not saved.");
        return;
      }
      setEditing(false);
      onMessage(limit === null ? `${label} has no monthly limit.` : `${label} is limited to $${limit.toFixed(2)} a month.`);
      await onSaved();
    } catch {
      setError("That limit was not saved.");
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    const typed = draft.trim();
    if (!typed) {
      void save(null);
      return;
    }
    const value = Number(typed);
    if (!Number.isFinite(value) || value < 0) {
      setError("Enter a dollar amount of 0 or more, or choose Unlimited.");
      return;
    }
    void save(Math.round(value * 100) / 100);
  }

  return (
    <div className="ai-key-spend" data-level={view.level} data-testid="ai-key-spend">
      <div className="ai-key-spend-line">
        <span id={`${id}-text`}>
          This month: <strong>{view.spentText}</strong>
          {view.limit === null ? " · Unlimited" : ` of ${view.limitText} · ${view.percent}% used`}
        </span>
        {canEdit && !editing ? (
          <button type="button" className="ai-keys-text-btn" onClick={open} aria-label={`Set the monthly limit for ${label}`}>
            {view.limit === null ? "Set limit" : "Change limit"}
          </button>
        ) : null}
      </div>
      {view.limit !== null ? (
        <div
          className="ai-key-spend-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(view.barPercent)}
          aria-labelledby={`${id}-text`}
        >
          <span style={{ width: `${view.barPercent}%` }} />
        </div>
      ) : null}
      {view.reached ? (
        <small className="ai-key-spend-note" role="status">
          Limit reached. Ask AI skips this key until {limitResetsOn()}
          {scope === "member" ? " and uses your next key or the team's connection instead." : " and uses the next key instead."}
        </small>
      ) : null}
      {editing ? (
        <form
          className="ai-key-spend-edit"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label>
            <span>Monthly limit (USD)</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={draft}
              placeholder="No limit"
              disabled={busy}
              aria-invalid={error ? true : undefined}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <div className="ai-key-spend-actions">
            <button type="button" className="ai-keys-text-btn" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" className="ai-keys-text-btn" disabled={busy} onClick={() => void save(null)}>
              Unlimited
            </button>
            <button type="submit" className="primary-action" disabled={busy}>
              {busy ? "Saving…" : "Save limit"}
            </button>
          </div>
          <small className="app-muted">Resets on the 1st of each month. Leave it blank for no limit.</small>
          {error ? <p className="ai-keys-field-error" role="alert">{error}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
