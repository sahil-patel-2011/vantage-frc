"use client";

import { useCallback, useEffect, useState } from "react";

type LiveStats = {
  ok: boolean;
  model: string | null;
  bind: string | null;
  upstreamOk: boolean | null;
  tokensIn: number;
  tokensOut: number;
  tokensOutPerSec: number;
  tokensDay: string | null;
  activeRequests: number;
  maxConcurrent: number;
  available: number;
  byFeature: Record<string, number>;
  isolation: string | null;
  error: string | null;
};

type Device = {
  id: string;
  name: string;
  lastSeenAt: string | null;
  lastProbeOk: boolean | null;
  lastProbeError: string | null;
  tokensDay: string | null;
  tokensInToday: string | number;
  tokensOutToday: string | number;
  tokensOutPerSec: string | number | null;
  activeRequests: number;
  maxConcurrent: number | null;
  model: string | null;
  bindLabel: string | null;
  upstreamOk: boolean | null;
  revokedAt: string | null;
};

type RelayMeta = {
  configured: boolean;
  model: string | null;
  models: Array<{ id: string; slug: string; label: string }>;
  refusal: string | null;
};

const num = (value: unknown) => Number(value ?? 0).toLocaleString();

export default function FreeRelayClient() {
  const [relay, setRelay] = useState<RelayMeta | null>(null);
  const [live, setLive] = useState<LiveStats | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [name, setName] = useState("frcvantagefreebuff relay");
  const [freshKey, setFreshKey] = useState<{ name: string; key: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/free-relay-devices");
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Unable to load FreeBuff Pis");
        setOk(false);
      } else {
        setRelay(data.relay ?? null);
        setLive(data.live ?? null);
        setDevices(data.devices ?? []);
        setOk(true);
        setMessage("");
      }
    } catch {
      setMessage("Could not reach the server.");
      setOk(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>, successCopy: string) {
    const response = await fetch("/api/admin/free-relay-devices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    setOk(response.ok);
    setMessage(response.ok ? successCopy : (data.error ?? "Update failed"));
    if (response.ok && data.key) setFreshKey({ name: String(data.name ?? name), key: String(data.key) });
    if (response.ok && data.live) setLive(data.live);
    if (response.ok) await load();
  }

  const featureChips = live?.byFeature ? Object.entries(live.byFeature) : [];

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">VANTAGE / FREEBUFF PIS</span>
          <h1>Connect and watch FreeBuff boxes</h1>
          <p className="app-muted">
            Platform box: <strong>frcvantagefreebuff relay</strong>. Keep Freebuff Coder UI
            signed in. Granted teams use this (or their own Pi) for all AI — GLM / MiMo
            only. Everyone else stays on API keys or included credits. Each org has its
            own coding folder; the session never shares another team’s files or memory.
          </p>
        </div>
        <a href="/admin/ai-grants">Team grants →</a>
      </header>

      {message && <p className={`telemetry-status${ok ? " success" : ""}`}>{message}</p>}
      {loading && <p className="app-muted">Loading FreeBuff devices…</p>}

      <section className="intel-panel">
        <span className="eyebrow">DEPLOYMENT RELAY</span>
        <p className="app-muted" style={{ marginTop: "0.5rem" }}>
          {relay?.configured
            ? `Vantage sends traffic to the configured FREE_RELAY_BASE_URL, clamped to ${relay.model ?? "deepseek/deepseek-v4-flash"}.`
            : relay?.refusal ?? "FREE_RELAY_BASE_URL is not set on this deployment."}
        </p>
        <small className="app-muted">
          Models: {relay?.models.map((model) => `${model.label} (${model.slug})`).join(" · ") || "—"}
        </small>
        <div className="intel-actions" style={{ marginTop: "1rem" }}>
          <button type="button" onClick={() => void post({ action: "probe" }, "Probed the configured relay.")}>
            Probe now
          </button>
          <button
            type="button"
            onClick={() =>
              void post(
                { action: "ensure_platform" },
                "frcvantagefreebuff relay is registered. Copy a new key only if one was issued.",
              )
            }
          >
            Register frcvantagefreebuff relay
          </button>
        </div>
      </section>

      <section className="intel-panel" style={{ marginTop: "1.5rem" }}>
        <span className="eyebrow">LIVE THROUGHPUT</span>
        {live?.error ? (
          <p className="app-muted" style={{ marginTop: "0.5rem" }}>
            {live.error} — zeros below are “no reading”, not invented usage.
          </p>
        ) : null}
        <div className="metric-grid" style={{ marginTop: "1rem" }}>
          <article>
            <span>tok/s out</span>
            <strong>{live && !live.error ? live.tokensOutPerSec.toFixed(2) : "—"}</strong>
            <small className="app-muted">average last 60s</small>
          </article>
          <article>
            <span>tokens in today</span>
            <strong>{live && !live.error ? num(live.tokensIn) : "—"}</strong>
            <small className="app-muted">{live?.tokensDay ?? "UTC day"}</small>
          </article>
          <article>
            <span>tokens out today</span>
            <strong>{live && !live.error ? num(live.tokensOut) : "—"}</strong>
            <small className="app-muted">this device</small>
          </article>
          <article>
            <span>in flight</span>
            <strong>
              {live && !live.error ? `${live.activeRequests}/${live.maxConcurrent || "—"}` : "—"}
            </strong>
            <small className="app-muted">chat + CAD + agents share the cap</small>
          </article>
        </div>
        {featureChips.length > 0 ? (
          <p className="app-muted" style={{ marginTop: "0.75rem" }}>
            Active now: {featureChips.map(([feature, count]) => `${feature} × ${count}`).join(" · ")}
          </p>
        ) : (
          <p className="app-muted" style={{ marginTop: "0.75rem" }}>
            No in-flight requests on the last probe. Concurrent loops are allowed up to the cap.
          </p>
        )}
        {live?.isolation ? (
          <small className="app-muted">{live.isolation}</small>
        ) : null}
      </section>

      <section className="intel-panel" style={{ marginTop: "1.5rem" }}>
        <span className="eyebrow">REGISTER A PI</span>
        <p className="app-muted" style={{ marginTop: "0.5rem" }}>
          Creates a named box and a one-time relay key. Put that key on the Pi as
          FREE_RELAY_API_KEY, tunnel 127.0.0.1:8080, then set FREE_RELAY_BASE_URL on Vercel.
        </p>
        <label style={{ display: "block", marginTop: "0.75rem" }}>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
        </label>
        <div className="intel-actions" style={{ marginTop: "1rem" }}>
          <button type="button" onClick={() => void post({ action: "create", name }, "Pi registered. Copy the key now.")}>
            Generate key
          </button>
        </div>
        {freshKey ? (
          <pre className="app-muted" style={{ marginTop: "1rem", whiteSpace: "pre-wrap" }}>
            {`# ${freshKey.name}
FREE_RELAY_API_KEY=${freshKey.key}
FREE_RELAY_MODEL=glm/glm-5.3-flash
# On the Pi:
bash scripts/pi/install-free-relay.sh
# Then tunnel 127.0.0.1:8080 and set FREE_RELAY_BASE_URL on Vercel.`}
          </pre>
        ) : null}
      </section>

      <section className="intel-panel" style={{ marginTop: "1.5rem" }}>
        <span className="eyebrow">REGISTERED BOXES</span>
        {!devices.length ? (
          <p className="app-muted" style={{ marginTop: "0.5rem" }}>
            No named Pis yet. The configured deployment relay above still works without a row.
          </p>
        ) : (
          devices.map((device) => (
            <article
              className="admin-org"
              key={device.id}
              style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline" }}
            >
              <div>
                <strong>{device.name}</strong>
                <small>
                  {device.revokedAt
                    ? "revoked"
                    : device.lastProbeOk
                      ? `${num(device.tokensInToday)} in / ${num(device.tokensOutToday)} out · ${device.tokensOutPerSec ?? "—"} tok/s`
                      : device.lastProbeError ?? "not probed yet"}
                </small>
              </div>
              {!device.revokedAt ? (
                <div className="intel-actions">
                  <button
                    type="button"
                    onClick={() => void post({ action: "probe", deviceId: device.id }, `Updated ${device.name}.`)}
                  >
                    Probe
                  </button>
                  <button
                    type="button"
                    onClick={() => void post({ action: "revoke", deviceId: device.id }, `${device.name} revoked.`)}
                  >
                    Revoke
                  </button>
                </div>
              ) : null}
            </article>
          ))
        )}
      </section>
    </main>
  );
}
