"use client";

import { useEffect, useState } from "react";

const install = `npm install
npm run build --workspace=@vantage/cad-cli
npm install -g ./packages/vantage-cad-cli
vantage-cad setup

# Or use install scripts:
# Windows: powershell -File .\\scripts\\cad\\install-cli.ps1
# macOS/Linux: bash scripts/cad/install-cli.sh`;

type Device = {
  id: string;
  machineName: string;
  platform: string;
  status: string;
  cliVersion: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

type OsRow = {
  os: string;
  vantageCadCli: string;
  fusion360Addin: string;
  fusion360Autodesk: string;
  onshapeHosted: string;
  notes: string;
};

export default function CadConnections({ orgId }: { orgId: string }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [message, setMessage] = useState("");
  const [onshapeConfigured, setOnshapeConfigured] = useState(false);
  const [onshapeConnections, setOnshapeConnections] = useState<
    Array<{ id: string; status: string; label: string }>
  >([]);
  const [osSupport, setOsSupport] = useState<OsRow[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch(`/api/cad?orgId=${encodeURIComponent(orgId)}`);
    const d = await r.json();
    if (r.ok) {
      setDevices(d.devices ?? []);
      setOnshapeConfigured(Boolean(d.onshapeConfigured));
      setOnshapeConnections(d.onshapeConnections ?? []);
      setOsSupport(d.osSupport ?? []);
    } else setMessage(d.error);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("onshape") === "connected") setMessage("Onshape OAuth connected.");
    if (params.get("onshape") === "denied") setMessage("Onshape authorization was denied.");
    if (params.get("onshape") === "error") setMessage(params.get("error") || "Onshape OAuth failed.");
    void load();
  }, [orgId]);

  async function revoke(deviceId: string) {
    if (!confirm("Revoke this CAD desktop? It will immediately lose job access.")) return;
    await fetch("/api/cad", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, action: "revoke-device", deviceId }),
    });
    await load();
  }

  async function connectOnshape() {
    setBusy(true);
    try {
      const response = await fetch("/api/cad/onshape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "authorize-url" }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Could not start Onshape OAuth");
        return;
      }
      window.location.href = data.url;
    } finally {
      setBusy(false);
    }
  }

  const onshapeConnected = onshapeConnections.some((c) => c.status === "connected");

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">CAD / CONNECTIONS</span>
          <h1>Connect engineering tools safely</h1>
          <p>Pair in the browser. Never type your Vantage password in a terminal.</p>
        </div>
        <nav className="intel-actions">
          <a href={`/cad?orgId=${orgId}`}>← CAD Builder</a>
          <a href={`/cad/setup?orgId=${orgId}`}>Setup wizard</a>
        </nav>
      </header>
      {message ? (
        <p role="status" className="telemetry-status">
          {message}
        </p>
      ) : null}

      <section className="connection-paths">
        <article className="intel-panel">
          <span className="path-number">01</span>
          <h2>Onshape hosted</h2>
          <p>
            Authorize least-privilege Onshape OAuth in the browser, then select a document, workspace, and element. The
            Vantage server runs approved jobs. No always-running desktop relay is required.
          </p>
          {onshapeConfigured ? (
            <>
              <button type="button" disabled={busy} onClick={() => void connectOnshape()}>
                {onshapeConnected ? "Reconnect Onshape OAuth" : "Connect Onshape OAuth"}
              </button>
              <small>
                {onshapeConnected
                  ? `Connected (${onshapeConnections[0]?.label ?? "Onshape"}). Pick document refs in CAD Builder.`
                  : "OAuth client configured — click to authorize."}
              </small>
            </>
          ) : (
            <>
              <button type="button" disabled title="Configure Onshape OAuth environment credentials first">
                Connect Onshape OAuth
              </button>
              <small>
                Setup required — admin must set ONSHAPE_OAUTH_CLIENT_ID and ONSHAPE_OAUTH_CLIENT_SECRET on Vercel, then
                redeploy.
              </small>
            </>
          )}
        </article>
        <article className="intel-panel">
          <span className="path-number">02</span>
          <h2>Fusion 360 local</h2>
          <p>
            Fusion runs in your Autodesk desktop session (Windows/macOS only). The paired relay claims signed jobs;
            Vercel never runs Fusion.
          </p>
          <ol>
            <li>Install Autodesk Fusion 360 and sign in.</li>
            <li>
              Run <code>scripts/cad/install-fusion-addin.ps1</code> (Windows) or{" "}
              <code>scripts/cad/install-fusion-addin.sh</code> (macOS).
            </li>
            <li>In Fusion: Utilities → Add-Ins → run VantageCadRelay.</li>
            <li>
              <code>vantage-cad setup</code> then <code>vantage-cad start</code>.
            </li>
          </ol>
          <small>Linux: Fusion is unavailable — use Onshape or VANTAGE_CAD_MOCK=1 for protocol tests.</small>
        </article>
      </section>

      <section className="intel-panel">
        <h2>OS support matrix</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>OS</th>
              <th>CLI</th>
              <th>Fusion add-in</th>
              <th>Onshape</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {osSupport.map((row) => (
              <tr key={row.os}>
                <td>{row.os}</td>
                <td>{row.vantageCadCli}</td>
                <td>{row.fusion360Addin}</td>
                <td>{row.onshapeHosted}</td>
                <td>{row.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="intel-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">LOCAL PACKAGE · NOT PUBLISHED TO NPM</span>
            <h2>Install the Vantage CAD CLI</h2>
          </div>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(install);
                setMessage("Install commands copied.");
              } catch {
                setMessage("Couldn't copy — copy it manually.");
              }
            }}
          >
            Copy commands
          </button>
        </div>
        <pre className="install-command">{install}</pre>
      </section>

      <section className="compare-panel">
        <h2>Paired desktops</h2>
        {devices.length === 0 ? (
          <p>No desktop is paired.</p>
        ) : (
          devices.map((device) => (
            <article className="saved-board" key={device.id}>
              <div>
                <strong>{device.machineName}</strong>
                <small>
                  {device.platform} · CLI {device.cliVersion ?? "unknown"} ·{" "}
                  {device.lastSeenAt ? `last seen ${new Date(device.lastSeenAt).toLocaleString()}` : "never seen"} ·{" "}
                  {device.revokedAt ? "revoked" : device.status}
                </small>
              </div>
              {!device.revokedAt && (
                <button type="button" onClick={() => void revoke(device.id)}>
                  Revoke
                </button>
              )}
            </article>
          ))
        )}
      </section>

      <section className="intel-panel">
        <h2>AI provider truth</h2>
        <ul>
          <li>Vantage managed API: billed through plan / credits.</li>
          <li>Team / personal BYOK: official provider API keys only.</li>
          <li>Terminal / local CLI (`key_source=local_cli`): no Vantage model charge.</li>
          <li>ChatGPT / Claude consumer subscriptions are not API credentials.</li>
        </ul>
      </section>
    </main>
  );
}
