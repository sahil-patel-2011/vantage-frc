"use client";

import { useState } from "react";
import { Button, Modal } from "../../components/ui";
import { BYOK_PROVIDERS, BYOK_PROVIDER_META, type ByokProvider } from "../../lib/ai-keys/byok-providers";
import { withOrgHref } from "../../lib/nav/product-nav";

/** Connect without losing the conversation. The server validates and encrypts the secret. */
export function ChatConnectDialog({ open, orgId, onClose, onConnected }: {
  open: boolean; orgId: string; onClose: () => void; onConnected: () => void;
}) {
  const [provider, setProvider] = useState<ByokProvider>("google");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => { if (!busy) { setKey(""); setError(""); onClose(); } };
  return <Modal open={open} onClose={close} title="Connect your AI" className="chat-connect-dialog">
    <p className="app-muted">Add your provider API key. It stays private to you. Your question will still be here when you return.</p>
    <form className="chat-connect-form" onSubmit={async event => {
      event.preventDefault();
      if (busy || !key.trim()) return;
      setBusy(true); setError("");
      try {
        const response = await fetch("/api/organizations/ai-keys", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "save_member_key", orgId, provider, apiKey: key.trim() }),
          signal: AbortSignal.timeout(30_000),
        });
        const data = await response.json().catch(() => ({})) as { error?: string; notice?: string };
        if (!response.ok) { setError(data.error || "Your key couldn’t be saved. Try again."); return; }
        setKey(""); onConnected(); onClose();
      } catch { setError("The server didn’t respond. Your question is safe; try connecting again."); }
      finally { setBusy(false); }
    }}>
      <label>Provider<select value={provider} disabled={busy} onChange={event => setProvider(event.target.value as ByokProvider)}>
        {BYOK_PROVIDERS.map(id => <option key={id} value={id}>{BYOK_PROVIDER_META[id].label}</option>)}
      </select></label>
      <label>API key<input type="password" value={key} required disabled={busy} autoComplete="off" spellCheck={false} placeholder={BYOK_PROVIDER_META[provider].placeholder} onChange={event => setKey(event.target.value)} /></label>
      <small className="app-muted">{BYOK_PROVIDER_META[provider].docsHint}</small>
      {error ? <p role="alert" className="ch-not-sent">{error}</p> : null}
      <div className="chat-connect-actions"><Button type="button" variant="secondary" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" variant="primary" disabled={busy || !key.trim()}>{busy ? "Checking…" : "Connect"}</Button></div>
    </form>
    <a className="chat-connect-settings" href={withOrgHref("/team/ai-keys?focus=yours", orgId)}>Manage keys and sharing</a>
  </Modal>;
}
