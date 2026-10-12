"use client";

import { useId, useState } from "react";
import { askConfirm } from "../../../components/ui";
import type { ByokKeyStatus, ByokProvider } from "../../../lib/ai-keys/byok-providers";
import type { ProviderMeta } from "./ai-keys-model";

/*
  The team's AI keys as one list and one "Add a key" form.

  It replaced a row of four provider cards, each with its own key box, status pill and Save
  and encrypt button: four forms on screen when a team uses one provider, and no way to keep a
  second key for the same provider. Now there is one list of the keys the team has saved (any
  number per provider, tried in order, each switched on or off) and one form with a provider
  dropdown. Secrets are never shown again; the list shows a name, the provider and how the key
  is doing.
*/

export type TeamKeyRow = {
  id: string;
  provider: string;
  label: string;
  priority: number;
  enabled: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
};

function when(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TeamKeyList({
  orgId,
  keyList,
  legacyStatuses,
  providers,
  canManage,
  setupBlocked,
  onChanged,
  onMessage,
}: {
  orgId: string;
  /** Every team key once migration 0727 is applied; undefined before it. */
  keyList: TeamKeyRow[] | undefined;
  /** Before 0727: one status per provider. */
  legacyStatuses: ByokKeyStatus[];
  providers: ProviderMeta[];
  canManage: boolean;
  setupBlocked: boolean;
  onChanged: () => Promise<void> | void;
  onMessage: (message: string, isError?: boolean) => void;
}) {
  const formId = useId();
  const [provider, setProvider] = useState<ByokProvider>(providers[0]?.id ?? "anthropic");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const meta = (id: string) => providers.find((entry) => entry.id === id);

  // Before 0727 there are no ids: show what is configured, one row per provider, read-only order.
  const rows: TeamKeyRow[] =
    keyList ??
    legacyStatuses
      .filter((status) => status.configured)
      .map((status, index) => ({
        id: `legacy:${status.provider}`,
        provider: status.provider,
        label: status.label,
        priority: index + 1,
        enabled: true,
        createdAt: status.createdAt,
        lastUsedAt: status.lastUsedAt,
        lastError: null,
      }));
  const multiKey = Boolean(keyList);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/organizations/ai-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, ...body }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; notice?: string | null; field?: string };
    return { ok: response.ok, data };
  }

  async function add() {
    const secret = apiKey.trim();
    if (!secret) return;
    setBusy("add");
    setFieldError(null);
    try {
      const { ok, data } = await post({ action: "save_key", provider, apiKey: secret, ...(label.trim() ? { label: label.trim() } : {}) });
      if (!ok) {
        setFieldError(data.error ?? "That key was not saved. Check it and try again.");
        return;
      }
      setApiKey("");
      setLabel("");
      onMessage(data.notice ?? `${meta(provider)?.label ?? "The provider"} accepted the key. It is saved and encrypted.`);
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function update(row: TeamKeyRow, change: { move?: "up" | "down"; enabled?: boolean }) {
    setBusy(row.id);
    try {
      const { ok, data } = await post({ action: "update_key", keyId: row.id, scope: "team", ...change });
      if (!ok) {
        onMessage(data.error ?? "That change was not saved.", true);
        return;
      }
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: TeamKeyRow) {
    const name = `${row.label} (${meta(row.provider)?.label ?? row.provider})`;
    const confirmed = await askConfirm({
      title: `Remove ${name}?`,
      body: "AI requests stop using it straight away. Any other key for this provider is tried instead.",
      confirmLabel: "Remove",
      tone: "destructive",
    });
    if (!confirmed) return;
    setBusy(row.id);
    try {
      const response = multiKey
        ? await post({ action: "remove_key", keyId: row.id, scope: "team" })
        : await fetch("/api/organizations/ai-keys", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ orgId, provider: row.provider }),
          }).then(async (res) => ({ ok: res.ok, data: (await res.json().catch(() => ({}))) as { error?: string } }));
      if (!response.ok) {
        onMessage(response.data.error ?? "That key was not removed.", true);
        return;
      }
      onMessage(`${name} removed.`);
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="ai-keys-list-wrap">
      {rows.length ? (
        <ul className="ai-keys-list" aria-label="Your team's saved keys">
          {rows.map((row) => {
            const sameProvider = rows.filter((other) => other.provider === row.provider);
            const place = sameProvider.findIndex((other) => other.id === row.id);
            const used = when(row.lastUsedAt);
            return (
              <li key={row.id} data-enabled={row.enabled ? "yes" : "no"} data-testid="ai-key-row">
                <span className="ai-keys-list-main">
                  <strong>{row.label}</strong>
                  <small>
                    {meta(row.provider)?.label ?? row.provider}
                    {sameProvider.length > 1 ? ` · tried ${place === 0 ? "first" : place === 1 ? "second" : `#${place + 1}`}` : ""}
                    {used ? ` · last used ${used}` : " · not used yet"}
                  </small>
                  {row.lastError ? <small className="ai-keys-list-error">{row.lastError}</small> : null}
                </span>
                {canManage && multiKey ? (
                  <span className="ai-keys-list-actions">
                    {sameProvider.length > 1 ? (
                      <>
                        <button type="button" className="ai-keys-icon-btn" aria-label={`Try ${row.label} earlier`} title="Try earlier"
                          disabled={busy !== null || place === 0} onClick={() => void update(row, { move: "up" })}>
                          <span aria-hidden="true">↑</span>
                        </button>
                        <button type="button" className="ai-keys-icon-btn" aria-label={`Try ${row.label} later`} title="Try later"
                          disabled={busy !== null || place === sameProvider.length - 1} onClick={() => void update(row, { move: "down" })}>
                          <span aria-hidden="true">↓</span>
                        </button>
                      </>
                    ) : null}
                    <label className="ai-keys-switch" title={row.enabled ? "On: AI uses this key" : "Off: AI skips this key"}>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={row.enabled}
                        disabled={busy !== null}
                        aria-label={`Use ${row.label}`}
                        onChange={(event) => void update(row, { enabled: event.target.checked })}
                      />
                      <span aria-hidden="true" />
                    </label>
                    <button type="button" className="ai-keys-text-btn is-danger" disabled={busy !== null} onClick={() => void remove(row)}>
                      Remove
                    </button>
                  </span>
                ) : canManage ? (
                  <button type="button" className="ai-keys-text-btn is-danger" disabled={busy !== null} onClick={() => void remove(row)}>
                    Remove
                  </button>
                ) : (
                  <span className="ai-keys-list-state">{row.enabled ? "On" : "Off"}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="app-muted ai-keys-list-empty">No team keys yet.</p>
      )}

      {canManage && !setupBlocked ? (
        <form
          className="ai-keys-add"
          aria-labelledby={`${formId}-title`}
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <h3 id={`${formId}-title`}>Add a key</h3>
          <div className="ai-keys-add-row">
            <label>
              <span>Provider</span>
              <select value={provider} disabled={busy === "add"} onChange={(event) => setProvider(event.target.value as ByokProvider)}>
                {providers.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            {multiKey ? (
              <label>
                <span>Name (optional)</span>
                <input
                  type="text"
                  maxLength={60}
                  value={label}
                  placeholder={`${meta(provider)?.label ?? "Provider"} key`}
                  disabled={busy === "add"}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </label>
            ) : null}
          </div>
          <label className="ai-keys-add-secret">
            <span>API key</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              placeholder={meta(provider)?.placeholder ?? ""}
              disabled={busy === "add"}
              aria-invalid={fieldError ? true : undefined}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <p className="app-muted ai-keys-add-hint">{meta(provider)?.docsHint}. Encrypted when saved and never shown again.</p>
          {fieldError ? (
            <p className="ai-keys-field-error" role="alert">
              {fieldError}
            </p>
          ) : null}
          <div className="ai-keys-add-actions">
            <button className="primary-action" type="submit" disabled={busy === "add" || !apiKey.trim()}>
              {busy === "add" ? "Checking…" : "Save key"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
