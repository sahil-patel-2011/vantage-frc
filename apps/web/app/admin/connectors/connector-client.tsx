"use client";
import { useEffect, useState } from "react";

type Credential = {
  id: string;
  opaqueKeyId: string;
  status: string;
  lastTestedAt: string | null;
  disabledAt: string | null;
};

export default function DataConnectorClient({ orgId }: { orgId?: string }) {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    const r = await fetch(
      `/api/admin/data-connectors${orgId ? `?orgId=${orgId}` : ""}`,
    );
    const d = await r.json();
    if (r.ok) {
      setCredentials(d.credentials ?? []);
      setHealth(d.health ?? null);
    } else {
      setMessage(d.error);
      setOk(false);
    }
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  async function act(
    action: "save" | "test" | "disable" | "sync",
    credentialId?: string,
    mode: "event-day" | "season" = "event-day",
  ) {
    setSyncing(action === "sync");
    const r = await fetch("/api/admin/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId,
        action,
        credentialId,
        apiKey: action === "save" ? key : undefined,
        syncMode: action === "sync" ? mode : undefined,
      }),
    });
    const d = await r.json();
    setSyncing(false);
    if (r.ok && action === "sync") {
      const summary = d.summary as Record<string, unknown> | undefined;
      setMessage(
        `Sync ${mode} finished — matches ${summary?.matches ?? 0}, teams ${summary?.teams ?? 0}, not-modified ${summary?.notModified ?? 0}.`,
      );
    } else {
      setMessage(
        r.ok
          ? action === "save"
            ? "Encrypted TBA credential saved. Test it before relying on it."
            : `Credential ${action} completed.`
          : d.error,
      );
    }
    setOk(r.ok);
    if (r.ok) {
      setKey("");
      await load();
    }
  }

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">
            {orgId ? "TEAM SETTINGS / FALLBACK" : "PLATFORM / LIVE DATA"}
          </span>
          <h1>TBA live-data connector</h1>
        </div>
        <a href={orgId ? `/team?orgId=${orgId}` : "/admin"}>← Settings</a>
      </header>
      {message && (
        <p role="status" className={`telemetry-status${ok ? " success" : ""}`}>
          {message}
        </p>
      )}
      <section className="intel-panel" style={{ marginBottom: 16 }}>
        <h2>Shared Neon cache (not Supabase)</h2>
        <p>
          Match, event, and team reference data live in{" "}
          <strong>Neon Postgres</strong>. One platform ingest worker fills those
          tables with TBA ETag/If-None-Match caching, in-flight dedupe, and
          polite backoff. Dashboards read the cache first — TBA is only
          contacted on miss/stale/ETag change. Adding Supabase would duplicate
          Neon; keep one shared cache.
        </p>
        <p>
          {orgId
            ? "Team BYO keys are a controlled fallback under rate pressure — they do not start a second unrestricted poller."
            : "Set the platform TBA_AUTH_KEY (or TBA_API_KEY alias, or save an encrypted platform credential below) so every org shares one polite ingest."}
        </p>
      </section>
      {!orgId && (
        <section className="intel-panel" style={{ marginBottom: 16 }}>
          <h2>Sync now</h2>
          <p>
            Event-day refresh hits active and subscribed events with ETags.
            Season sync rebuilds the full year list and metrics.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              className="primary-action"
              type="button"
              disabled={syncing}
              onClick={() => void act("sync", undefined, "event-day")}
            >
              {syncing ? "Syncing…" : "Sync active events"}
            </button>
            <button
              type="button"
              disabled={syncing}
              onClick={() => void act("sync", undefined, "season")}
            >
              Full season sync
            </button>
          </div>
        </section>
      )}
      {orgId ? (
        <section className="intel-panel" style={{ marginBottom: 16 }}>
          <h2>Sync active event</h2>
          <p>
            Refreshes match and team data for the event selected in Command. Uses the platform key with your team
            fallback credential when configured.
          </p>
          <button
            className="primary-action"
            type="button"
            disabled={syncing}
            onClick={() => void act("sync", undefined, "event-day")}
          >
            {syncing ? "Syncing…" : "Sync active event"}
          </button>
        </section>
      ) : null}
      <section className="admin-grid">
        <form
          className="intel-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void act("save");
          }}
        >
          <h2>
            {orgId
              ? "Optional fallback key"
              : "Platform-managed Read API key"}
          </h2>
          <p>
            {orgId
              ? "Vantage normally uses one shared platform key. Add a team key only when platform health reports a sustained issue; it remains a controlled scheduler fallback and does not create duplicate polling."
              : "One encrypted key powers the global ingest worker for every organization. The key is write-only after save."}
          </p>
          <label>
            TBA Read API v3 key
            <input
              type="password"
              autoComplete="off"
              required
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Encrypted on save — never shown again"
            />
          </label>
          <button className="primary-action">Encrypt and save</button>
        </form>
        <article className="intel-panel">
          <h2>How to get a TBA key</h2>
          <ol>
            <li>
              Open{" "}
              <a
                href="https://www.thebluealliance.com/account"
                target="_blank"
                rel="noreferrer"
              >
                thebluealliance.com/account
              </a>
              .
            </li>
            <li>Sign in to your Blue Alliance account.</li>
            <li>
              Under Read API Keys, create a v3 key (name it e.g. “Vantage
              platform” or “Vantage team fallback”).
            </li>
            <li>
              Paste the key here, save, then press Test. The full key is never
              shown again — only an opaque id.
            </li>
          </ol>
          <p>
            Any credential pasted into chat or another public channel is exposed
            and must be rotated; never reuse it here.
          </p>
        </article>
      </section>
      <section className="compare-panel">
        <h2>Credential status</h2>
        {credentials.length === 0 ? (
          <p>
            No TBA key is configured. Widgets stay empty until a platform key
            (or tested fallback) and ingest populate Neon.
          </p>
        ) : (
          credentials.map((item) => (
            <article className="saved-board" key={item.id}>
              <div>
                <strong>{item.opaqueKeyId}</strong>
                <small>
                  {item.status} ·{" "}
                  {item.lastTestedAt
                    ? `tested ${new Date(item.lastTestedAt).toLocaleString()}`
                    : "never tested"}
                </small>
              </div>
              <button onClick={() => void act("test", item.id)}>
                Test connection
              </button>
              <button
                onClick={() =>
                  confirm(
                    `Disable credential ${item.opaqueKeyId}? Scheduled tests and reads will stop.`,
                  ) && void act("disable", item.id)
                }
              >
                Disable
              </button>
            </article>
          ))
        )}
        <h2>Ingestion health</h2>
        <pre className="health-summary">
          {health
            ? JSON.stringify(health, null, 2)
            : "No health data yet. Run Sync now or wait for the event-day cron."}
        </pre>
      </section>
    </main>
  );
}
