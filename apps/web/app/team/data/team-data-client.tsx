"use client";

import { useEffect, useMemo, useState } from "react";

type InventoryRow = { label: string; count: number };
type Credential = {
  id: string;
  opaqueKeyId: string;
  status: string;
  lastTestedAt: string | null;
  disabledAt: string | null;
};

export default function TeamDataClient({ orgId }: { orgId: string }) {
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [reference, setReference] = useState<InventoryRow[]>([]);
  const [activeEventKey, setActiveEventKey] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const exportHref = useMemo(() => `/exports?orgId=${encodeURIComponent(orgId)}`, [orgId]);

  async function load() {
    const response = await fetch(`/api/team/data?orgId=${encodeURIComponent(orgId)}`);
    const data = await response.json();
    if (response.ok) {
      setInventory(data.inventory ?? []);
      setReference(data.reference ?? []);
      setActiveEventKey(data.activeEventKey ?? null);
      setCredentials(data.credentials ?? []);
      setHealth(data.health ?? null);
      setOk(true);
      setMessage("");
    } else {
      setOk(false);
      setMessage(data.error ?? "Unable to load team data analytics");
    }
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  async function syncActiveEvent() {
    setBusy(true);
    const response = await fetch("/api/team/data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, action: "sync" }),
    });
    const data = await response.json();
    setBusy(false);
    setOk(response.ok);
    if (response.ok) {
      const summary = data.summary as Record<string, unknown> | undefined;
      setMessage(
        `Sync finished — matches ${summary?.matches ?? 0}, teams ${summary?.teams ?? 0}, not-modified ${summary?.notModified ?? 0}.`,
      );
      await load();
    } else {
      setMessage(data.error ?? "Sync failed");
    }
  }

  async function saveFallbackKey(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const response = await fetch("/api/admin/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, action: "save", apiKey: key }),
    });
    const data = await response.json();
    setBusy(false);
    setOk(response.ok);
    setMessage(response.ok ? "Encrypted TBA fallback key saved. Test it before relying on it." : data.error ?? "Save failed");
    if (response.ok) {
      setKey("");
      await load();
    }
  }

  async function testCredential(credentialId: string) {
    setBusy(true);
    const response = await fetch("/api/admin/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, action: "test", credentialId }),
    });
    const data = await response.json();
    setBusy(false);
    setOk(response.ok);
    setMessage(response.ok ? "Credential test succeeded." : data.error ?? "Test failed");
    if (response.ok) await load();
  }

  return (
    <main className="module-page team-data-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Team / Live data</span>
          <h1>Data analytics</h1>
          <p>
            Inventory counts for your workspace, shared TBA cache health, and controlled sync for the active event. Export
            audited CSV, PDF, or ZIP archives from Export Center.
          </p>
        </div>
        <div className="team-data-header-actions">
          <a className="app-button secondary" href={exportHref}>
            Export Center
          </a>
          <a className="app-button secondary" href={`/exports?orgId=${encodeURIComponent(orgId)}&action=pdf`}>
            PDF inventory
          </a>
        </div>
      </header>

      <nav className="team-data-cross-nav" aria-label="Related team modules">
        <a href={`/scouting?orgId=${encodeURIComponent(orgId)}`}>Scouting</a>
        <a href={`/strategy?orgId=${encodeURIComponent(orgId)}`}>Strategy</a>
        <a href={exportHref}>Exports</a>
        <a href={`/team/usage?orgId=${encodeURIComponent(orgId)}`}>AI usage</a>
      </nav>

      {message ? (
        <p className={`telemetry-status${ok ? " success" : ""}`} role="status">
          {message}
        </p>
      ) : null}

      <div className="team-data-layout">
        <section className="app-card soft-panel team-data-panel">
          <h2>Workspace inventory</h2>
          <p className="app-muted">
            Active event: <strong>{activeEventKey ?? "Not set"}</strong>
          </p>
          <ul className="team-data-inventory">
            {inventory.map((row) => (
              <li key={row.label}>
                <span>{row.label.replace(/_/g, " ")}</span>
                <strong>{row.count.toLocaleString()}</strong>
              </li>
            ))}
          </ul>
          <h3>Shared reference cache</h3>
          <ul className="team-data-inventory reference">
            {reference.map((row) => (
              <li key={row.label}>
                <span>{row.label.replace(/_/g, " ")}</span>
                <strong>{row.count.toLocaleString()}</strong>
              </li>
            ))}
          </ul>
        </section>

        <aside className="team-data-side">
          <section className="app-card soft-panel team-data-panel">
            <h2>Sync active event</h2>
            <p className="app-muted">
              Refreshes match and team data for the event selected in Command. Uses the platform key with your fallback
              credential when configured.
            </p>
            <button type="button" className="app-button" disabled={busy} onClick={() => void syncActiveEvent()}>
              {busy ? "Working…" : "Sync active event"}
            </button>
          </section>

          <section className="app-card soft-panel team-data-panel">
            <h2>TBA fallback key</h2>
            <p className="app-muted">
              Optional encrypted fallback when platform ingest is under pressure. Saved via the same connector path as team
              settings.
            </p>
            <form className="team-data-key-form" onSubmit={saveFallbackKey}>
              <label>
                TBA Read API v3 key
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  placeholder="Encrypted on save — never shown again"
                  required
                />
              </label>
              <button type="submit" className="app-button secondary" disabled={busy || !key.trim()}>
                Encrypt and save
              </button>
            </form>
            {credentials.length ? (
              <ul className="team-data-credentials">
                {credentials.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.opaqueKeyId}</strong>
                      <small>{item.status}</small>
                    </div>
                    <button type="button" className="app-button secondary sm" disabled={busy} onClick={() => void testCredential(item.id)}>
                      Test
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="app-muted">No fallback credential configured.</p>
            )}
          </section>

          <section className="app-card soft-panel team-data-panel">
            <h2>Ingestion health</h2>
            <pre className="team-data-health">{health ? JSON.stringify(health, null, 2) : "No health telemetry yet."}</pre>
          </section>
        </aside>
      </div>
    </main>
  );
}