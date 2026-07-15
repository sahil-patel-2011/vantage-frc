"use client";

import { useEffect, useState } from "react";

type Invite = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  acceptedAt: string | null;
  lastSentAt: string;
};

export default function TeamAdminClient({ orgId }: { orgId: string }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("scout");
  const [message, setMessage] = useState("");
  const [providers, setProviders] = useState<Array<{ id: string; label: string; kind: string; localRelay: boolean; enabled: boolean }>>([]);
  const [provider, setProvider] = useState({ kind: "openai-compatible", label: "", baseUrl: "", apiKey: "", localRelay: false, model: "" });
  async function load() {
    const response = await fetch(`/api/organizations/invites?orgId=${orgId}`);
    const data = await response.json();
    setInvites(data.invites ?? []);
    if (!response.ok) setMessage(data.error);
    const providerResponse = await fetch(`/api/organizations/providers?orgId=${orgId}`);
    const providerData = await providerResponse.json();
    setProviders(providerData.providers ?? []);
  }
  useEffect(() => { void load(); }, [orgId]);
  async function invite(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/organizations/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, email, role }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Invitation sent." : data.error);
    if (response.ok) { setEmail(""); await load(); }
  }
  async function act(inviteId: string, action: "resend" | "revoke") {
    const response = await fetch("/api/organizations/invites", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, inviteId, action }),
    });
    const data = await response.json();
    setMessage(response.ok ? `Invite ${action === "resend" ? "resent" : "revoked"}.` : data.error);
    if (response.ok) await load();
  }
  async function saveProvider(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/organizations/providers", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, ...provider, modelMappings: { default: provider.model } }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Custom provider encrypted and saved." : data.error);
    if (response.ok) { setProvider({ ...provider, apiKey: "" }); await load(); }
  }
  return (
    <main className="intel-app">
      <header className="intel-header"><div><span className="eyebrow">VANTAGE / TEAM ADMIN</span><h1>Membership control</h1></div><a href={`/intel?orgId=${orgId}`}>Open Intel →</a></header>
      <section className="admin-grid">
        <form className="intel-panel" onSubmit={invite}>
          <span className="eyebrow">INVITE A SPECIFIC EMAIL</span>
          <p>Team numbers never grant access. The recipient must verify this exact address.</p>
          <label>Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Role<select value={role} onChange={(e) => setRole(e.target.value)}><option value="admin">Admin</option><option value="scout">Scout</option><option value="viewer">Viewer</option></select></label>
          <button className="primary-action">Send invitation</button>
          {message && <p className="auth-message">{message}</p>}
        </form>
        <section className="intel-panel invite-list"><span className="eyebrow">INVITATION LEDGER</span>
          {invites.map((invite) => <article key={invite.id}><div><strong>{invite.email}</strong><small>{invite.role} · {invite.status}</small></div><time>{invite.acceptedAt ? `Accepted ${new Date(invite.acceptedAt).toLocaleDateString()}` : `Expires ${new Date(invite.expiresAt).toLocaleString()}`}</time>{invite.status === "pending" && <div><button onClick={() => act(invite.id, "resend")}>Resend</button><button onClick={() => act(invite.id, "revoke")}>Revoke</button></div>}</article>)}
        </section>
      </section>
      <section className="compare-panel"><span className="eyebrow">CUSTOM / LOCAL MODEL PROVIDER</span><div className="admin-grid">
        <form className="intel-panel" onSubmit={saveProvider}><p>Custom providers are available without a managed plan. Usage stays visible, but model quality may vary.</p>
          <label>Label<input required value={provider.label} onChange={(e) => setProvider({ ...provider, label: e.target.value })} /></label>
          <label className="check-field"><input type="checkbox" checked={provider.localRelay} onChange={(e) => setProvider({ ...provider, localRelay: e.target.checked })} /> Local/LAN through desktop relay</label>
          {!provider.localRelay && <label>HTTPS OpenAI-compatible base URL<input required type="url" value={provider.baseUrl} onChange={(e) => setProvider({ ...provider, baseUrl: e.target.value })} /></label>}
          <label>Provider model mapping<input required value={provider.model} onChange={(e) => setProvider({ ...provider, model: e.target.value })} /></label>
          <label>API key (optional)<input type="password" autoComplete="off" value={provider.apiKey} onChange={(e) => setProvider({ ...provider, apiKey: e.target.value })} /></label>
          <button className="primary-action">Encrypt and save provider</button>
        </form>
        <section className="intel-panel">{providers.map((item) => <article className="admin-org" key={item.id}><b>{item.localRelay ? "RELAY" : "API"}</b><div><strong>{item.label}</strong><small>{item.kind} · {item.enabled ? "enabled" : "disabled"}</small></div></article>)}</section>
      </div></section>
    </main>
  );
}
