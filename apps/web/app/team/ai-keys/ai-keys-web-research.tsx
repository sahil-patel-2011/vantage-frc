"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * "Let the AI look things up" — a team's own free TinyFish key.
 *
 * Self-contained on purpose: it owns its fetch and its state, so the AI keys
 * page gains a section without its ready view growing another 150 lines, and
 * a TinyFish outage can only ever affect this card.
 */

type Failure = "invalid_key" | "rate_limited" | "unavailable" | "bad_request";

type Status = {
  configured: boolean;
  hint: string | null;
  verifiedAt: string | null;
  lastUsedAt: string | null;
  lastError: Failure | null;
  lastErrorAt: string | null;
};

type Payload = {
  tinyfish: Status;
  canManage: boolean;
  keyPageUrl: string;
  setupRequired: boolean;
  setupMessage: string | null;
};

const WHEN = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function when(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : WHEN.format(date);
}

/**
 * The badge, in the words a mentor would use.
 *
 * A key TinyFish has stopped accepting must not keep saying "Connected" — the
 * agent would be answering without the web and nobody would know why. The
 * last call's outcome is recorded (migration 0667) precisely so this can say so.
 */
function badge(status: Status): { tone: "ok" | "missing" | "warn"; label: string } {
  if (!status.configured) return { tone: "missing", label: "Not set up" };
  if (status.lastError === "invalid_key") return { tone: "warn", label: "Key rejected" };
  if (status.lastError === "rate_limited") return { tone: "warn", label: "Over today's limit" };
  return { tone: "ok", label: "Connected" };
}

export function WebResearchCard({ orgId }: { orgId: string }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/organizations/tool-keys?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLoadError(typeof body?.error === "string" ? body.error : "Could not load web research settings.");
        return;
      }
      setLoadError(null);
      setPayload(body as Payload);
    } catch {
      setLoadError("Could not load web research settings.");
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const apiKey = draft.trim();
    if (!apiKey) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/organizations/tool-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, tool: "tinyfish", apiKey }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ tone: "error", text: typeof body?.error === "string" ? body.error : "Could not save the key." });
        return;
      }
      // Cleared the moment it is stored: a key sitting in a text box is a key on
      // screen for whoever walks past the laptop.
      setDraft("");
      setMessage({ tone: "ok", text: "TinyFish accepted the key. The AI can search the web now." });
      await load();
    } catch {
      setMessage({ tone: "error", text: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/organizations/tool-keys", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ tone: "error", text: typeof body?.error === "string" ? body.error : "Could not remove the key." });
        return;
      }
      setMessage({ tone: "ok", text: "Key removed. The AI will answer without the web." });
      await load();
    } catch {
      setMessage({ tone: "error", text: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  };

  const status = payload?.tinyfish;
  const state = status ? badge(status) : null;

  return (
    <section
      className="app-card soft-panel ai-keys-web"
      aria-labelledby="ai-keys-web-title"
      data-configured={status?.configured ? "yes" : "no"}
    >
      <header className="ai-keys-provider-head">
        <div>
          <h2 id="ai-keys-web-title">Web research</h2>
          <span className="app-muted">Powered by TinyFish · free</span>
        </div>
        {state ? <span className={`ai-keys-status ${state.tone}`}>{state.label}</span> : null}
      </header>

      <p>
        Add a free TinyFish key and the AI can search the web and read pages when your question needs something current —
        this season&rsquo;s game manual, a motor&rsquo;s datasheet, a Chief Delphi thread about the mechanism you are
        building.
      </p>
      <p className="ai-keys-meta app-muted">
        It runs on your team&rsquo;s own free quota: 500 searches an hour and 1,000 pages a day, which no other team can
        use up. The AI only reads pages that came up in its own search or that you linked, so a web page cannot steer it
        into sending your team&rsquo;s notes anywhere.
      </p>

      {loadError ? (
        <p className="ai-keys-warn" role="alert">
          {loadError}
        </p>
      ) : null}

      {status?.configured ? (
        <p className="ai-keys-meta app-muted">
          {status.hint ? `Key ending in …${status.hint}` : "Key saved"} · stored locked away
          {when(status.lastUsedAt) ? ` · last used ${when(status.lastUsedAt)}` : ""}
          {!status.lastUsedAt && when(status.verifiedAt) ? ` · checked ${when(status.verifiedAt)}` : ""}.
        </p>
      ) : null}

      {status?.lastError === "invalid_key" ? (
        <p className="ai-keys-warn" role="note">
          TinyFish stopped accepting this key{when(status.lastErrorAt) ? ` on ${when(status.lastErrorAt)}` : ""}, so the AI
          has been answering without the web. Paste a new key below.
        </p>
      ) : null}
      {status?.lastError === "rate_limited" ? (
        <p className="ai-keys-meta app-muted" role="note">
          Your free quota ran out{when(status.lastErrorAt) ? ` at ${when(status.lastErrorAt)}` : ""}. It resets on its
          own; nothing to do.
        </p>
      ) : null}

      {payload?.setupRequired ? (
        <p className="ai-keys-warn" role="note">
          {payload.setupMessage ?? "Key encryption is not set up on this server yet."}
        </p>
      ) : null}

      {payload && payload.canManage && !payload.setupRequired ? (
        <form
          className="ai-keys-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label>
            {status?.configured ? "Replace TinyFish key" : "TinyFish API key"}
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-tinyfish-…"
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <div className="ai-keys-actions">
            <button className="primary-action" type="submit" disabled={busy || !draft.trim()}>
              {busy ? "Checking…" : status?.configured ? "Check & replace" : "Check & save"}
            </button>
            {status?.configured ? (
              <button className="danger-action" type="button" disabled={busy} onClick={() => void remove()}>
                Remove key
              </button>
            ) : null}
            <a className="ai-keys-link" href={payload.keyPageUrl} target="_blank" rel="noopener noreferrer">
              Get a free key
            </a>
          </div>
        </form>
      ) : null}

      {payload && !payload.canManage ? (
        <p className="ai-keys-meta app-muted">
          {status?.configured
            ? "Your team has web research switched on."
            : "Ask an owner or admin to add a free TinyFish key here."}
        </p>
      ) : null}

      {message ? (
        <p className={message.tone === "ok" ? "ai-keys-flash" : "ai-keys-warn"} role="status">
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
