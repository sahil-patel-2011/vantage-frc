"use client";

import { useEffect, useMemo, useState } from "react";

const install = `# Windows (recommended one-shot):
# powershell -ExecutionPolicy Bypass -File .\\scripts\\cad\\install-windows.ps1

# Or manual (all OS):
npm install
npm run build --workspace=@vantage/cad-cli
npm install -g ./packages/vantage-cad-cli
vantage-cad setup
# Optional CI/demo without Fusion:
# set VANTAGE_CAD_MOCK=1
vantage-cad start
# Update later: vantage-cad update`;

type Device = {
  id: string;
  machineName: string;
  platform: string;
  status: string;
  cliVersion: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

type Connection = { id: string; status: string; label: string; shared?: boolean };

type Step = 1 | 2 | 3 | 4;

type CadTarget = "onshape" | "fusion360" | "mock";
type Brain = "managed_api" | "team_byok" | "terminal_cli" | "mock";

/** The exact server variables the hosted Onshape path needs, so setup_required is actionable. */
const ONSHAPE_ENV = {
  oauth: ["ONSHAPE_OAUTH_CLIENT_ID", "ONSHAPE_OAUTH_CLIENT_SECRET"],
  oauthOptional: ["ONSHAPE_OAUTH_REDIRECT_URI"],
  apiKeys: ["ONSHAPE_ACCESS_KEY", "ONSHAPE_SECRET_KEY"],
} as const;

export default function CadSetupWizard({ orgId }: { orgId: string }) {
  const [step, setStep] = useState<Step>(1);
  // Defaults are the real product path: Onshape in the cloud, driven by the
  // hosted web agent. Mock / terminal / Fusion live behind "Advanced".
  const [cadTarget, setCadTarget] = useState<CadTarget>("onshape");
  const [brain, setBrain] = useState<Brain>("managed_api");
  const [advancedCad, setAdvancedCad] = useState(false);
  const [advancedBrain, setAdvancedBrain] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [message, setMessage] = useState("");
  const [onshapeConfigured, setOnshapeConfigured] = useState<boolean | null>(null);
  const [onshapeSetupMessage, setOnshapeSetupMessage] = useState("");

  async function load() {
    const response = await fetch(`/api/cad?orgId=${encodeURIComponent(orgId)}`);
    const data = await response.json();
    if (response.ok) {
      setDevices(data.devices ?? []);
      setConnections(data.onshapeConnections ?? []);
      setOnshapeConfigured(Boolean(data.onshapeConfigured ?? data.onshape?.configured));
      setOnshapeSetupMessage(
        data.onshape?.setupRequired
          ? String(data.onshape.message ?? "Setup required — configure Onshape OAuth on the server.")
          : "",
      );
    } else setMessage(data.error);
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [orgId]);

  const online = useMemo(
    () => devices.find((device) => !device.revokedAt && device.lastSeenAt),
    [devices],
  );
  const onshapeConnected = connections.some((connection) => connection.status === "connected");
  const teamShared = connections.some((connection) => connection.status === "connected" && connection.shared);

  const q = `?orgId=${encodeURIComponent(orgId)}`;
  // Onshape + hosted agent needs no desktop pairing; the last two steps become
  // "connect" and "verify the connection" instead of "install & pair" / "heartbeat".
  const hostedPath = cadTarget === "onshape" && brain !== "terminal_cli";
  const stepLabels = hostedPath
    ? ["CAD target", "AI brain", "Connect Onshape", "Verify"]
    : ["CAD target", "AI brain", "Install & pair", "Verify"];

  return (
    <main className="module-page cad-setup-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">CAD / Setup</span>
          <h1>Connect CAD + AI brain</h1>
          <p>
            Onshape in the cloud, driven by the hosted agent, is the default path. Geometry changes are proposed as
            reviewable tool calls in Plan mode and run only after approval. This is not certified engineering software.
          </p>
        </div>
        <nav className="cad-header-actions">
          <a className="app-button secondary" href={`/cad${q}`}>
            ← CAD Builder
          </a>
          <a className="app-button secondary" href={`/cad/connections${q}`}>
            Connections
          </a>
          <a className="app-button secondary" href={`/cad/pair${q}`}>
            Pair desktop
          </a>
        </nav>
      </header>

      {message ? (
        <p className="telemetry-status" role="status">
          {message}
        </p>
      ) : null}

      {onshapeConfigured === false && cadTarget === "onshape" ? (
        <aside className="cad-setup-required" role="status">
          <strong>Setup required · Onshape</strong>
          <p>{onshapeSetupMessage || "The Onshape OAuth client is not configured on this server."}</p>
          <p>
            An admin sets these on the server (Vercel → Environment Variables), then redeploys:
          </p>
          <ul>
            {ONSHAPE_ENV.oauth.map((name) => (
              <li key={name}>
                <code>{name}</code> — from the Onshape developer portal OAuth application
              </li>
            ))}
            {ONSHAPE_ENV.oauthOptional.map((name) => (
              <li key={name}>
                <code>{name}</code> — optional; defaults to <code>/api/cad/onshape/oauth/callback</code> on this deployment
              </li>
            ))}
          </ul>
          <p>
            Alternative without OAuth: a server-wide API key pair, <code>{ONSHAPE_ENV.apiKeys[0]}</code> and{" "}
            <code>{ONSHAPE_ENV.apiKeys[1]}</code>, from{" "}
            <a href="https://dev-portal.onshape.com/keys" target="_blank" rel="noreferrer">
              dev-portal.onshape.com/keys
            </a>
            . Until one of these is set, the agent reports setup_required instead of inventing geometry.
          </p>
        </aside>
      ) : null}

      <ol className="cad-setup-steps" aria-label="CAD setup progress">
        {stepLabels.map((label, index) => {
          const n = (index + 1) as Step;
          return (
            <li
              key={label}
              className={n < step ? "active" : undefined}
              aria-current={n === step ? "step" : undefined}
            >
              <b>{n}</b>
              <span>{label}</span>
            </li>
          );
        })}
      </ol>

      {step === 1 ? (
        <section className="cad-setup-panel">
          <h2>1. CAD platform</h2>
          <p className="app-muted" style={{ margin: 0 }}>
            Onshape runs in the cloud for every OS and is what the hosted agent drives. Fusion and the mock adapter are
            advanced paths.
          </p>
          <label className="cad-choice">
            <input type="radio" name="cad" checked={cadTarget === "onshape"} onChange={() => setCadTarget("onshape")} />
            <span>
              <strong>Onshape hosted (recommended)</strong>
              <small>
                {onshapeConfigured === false
                  ? "Setup required — see the server variables above. You can still read the steps; nothing will run until an admin sets them."
                  : onshapeConnected
                    ? `Connected${teamShared ? " (shared with the team)" : ""}. Bind a Part Studio in CAD Builder and start a brief.`
                    : "OAuth client is configured — connect your Onshape account in the next steps."}
              </small>
            </span>
          </label>
          <details className="cad-setup-advanced" open={advancedCad} onToggle={(event) => setAdvancedCad((event.target as HTMLDetailsElement).open)}>
            <summary>Advanced: Fusion 360 local relay, mock adapter</summary>
            <label className="cad-choice">
              <input
                type="radio"
                name="cad"
                checked={cadTarget === "fusion360"}
                onChange={() => setCadTarget("fusion360")}
              />
              <span>
                <strong>Fusion 360 local relay</strong>
                <small>Jobs stay on your machine via vantage-cad + the VantageCadRelay add-in. The server never runs Fusion.</small>
              </span>
            </label>
            <label className="cad-choice">
              <input type="radio" name="cad" checked={cadTarget === "mock"} onChange={() => setCadTarget("mock")} />
              <span>
                <strong>Mock adapter</strong>
                <small>CI / demo path with deterministic topology + render. Not real geometry.</small>
              </span>
            </label>
          </details>
          <div className="cad-setup-actions">
            <button className="primary-action" type="button" onClick={() => setStep(2)}>
              Continue
            </button>
            <a className="app-button secondary" href={`/cad/connections${q}`}>
              Open Connections
            </a>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="cad-setup-panel">
          <h2>2. AI brain / billing path</h2>
          <label className="cad-choice">
            <input
              type="radio"
              name="brain"
              checked={brain === "managed_api"}
              onChange={() => setBrain("managed_api")}
            />
            <span>
              <strong>Hosted web agent — Vantage managed API (recommended)</strong>
              <small>
                The /cad page plans and builds through the server. Meters Vantage credits / org limits as usual; see
                Prompt caching under API budgets.
              </small>
            </span>
          </label>
          <details className="cad-setup-advanced" open={advancedBrain} onToggle={(event) => setAdvancedBrain((event.target as HTMLDetailsElement).open)}>
            <summary>Advanced: BYOK keys, terminal CLI, mock brain</summary>
            <label className="cad-choice">
              <input type="radio" name="brain" checked={brain === "team_byok"} onChange={() => setBrain("team_byok")} />
              <span>
                <strong>Team / personal BYOK API</strong>
                <small>Official provider API keys only (encrypted in Admin). Consumer subscriptions are not keys.</small>
              </span>
            </label>
            <label className="cad-choice">
              <input
                type="radio"
                name="brain"
                checked={brain === "terminal_cli"}
                onChange={() => setBrain("terminal_cli")}
              />
              <span>
                <strong>Terminal / local CLI</strong>
                <small>
                  No Vantage model charge (`key_source=local_cli`). Claude Code drives Onshape through the vantage-cad MCP
                  connector using your own CLI login.
                </small>
              </span>
            </label>
            <label className="cad-choice">
              <input type="radio" name="brain" checked={brain === "mock"} onChange={() => setBrain("mock")} />
              <span>
                <strong>Mock brain</strong>
                <small>Deterministic brief/planner stubs for demos and CI.</small>
              </span>
            </label>
          </details>
          <div className="cad-setup-actions">
            <button type="button" className="app-button secondary" onClick={() => setStep(1)}>
              Back
            </button>
            <button className="primary-action" type="button" onClick={() => setStep(3)}>
              Continue
            </button>
            {brain === "managed_api" ? (
              <a className="app-button secondary" href={`/team/budgets${q}#prompt-caching`}>
                Prompt caching
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      {step === 3 && hostedPath ? (
        <section className="cad-setup-panel">
          <h2>3. Connect Onshape</h2>
          <p style={{ margin: 0 }}>
            Target: <strong>{cadTarget}</strong> · Brain: <strong>{brain}</strong> · no desktop pairing needed.
          </p>
          <ol style={{ margin: 0, paddingLeft: 18, color: "var(--app-muted)", fontSize: 13 }}>
            <li>
              Open <a href={`/cad/connections${q}`}>Connections</a> and click <strong>Connect Onshape OAuth</strong>{" "}
              (least-privilege read + write scopes).
            </li>
            <li>
              Owners/admins can then <strong>Share with team</strong> so students use the CAD agent without their own
              Onshape login.
            </li>
            <li>In CAD Builder, paste a disposable document URL and Bind — never the competition robot document.</li>
          </ol>
          {onshapeConfigured === false ? (
            <p className="telemetry-status" role="status">
              The Connect button stays disabled until an admin sets the Onshape server variables listed at the top of
              this page.
            </p>
          ) : null}
          <div className="cad-setup-actions">
            <button type="button" className="app-button secondary" onClick={() => setStep(2)}>
              Back
            </button>
            <a className="primary-action" href={`/cad/connections${q}`}>
              Open Connections
            </a>
            <button className="app-button secondary" type="button" onClick={() => setStep(4)}>
              Continue to verify
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 && !hostedPath ? (
        <section className="cad-setup-panel">
          <h2>3. Install & pair</h2>
          <p style={{ margin: 0 }}>
            Target: <strong>{cadTarget}</strong> · Brain: <strong>{brain}</strong>
          </p>
          <div className="cad-setup-actions" style={{ justifyContent: "space-between" }}>
            <div>
              <span className="eyebrow">Windows / macOS / Linux</span>
              <h3 style={{ margin: "4px 0 0", fontSize: 15 }}>vantage-cad CLI</h3>
            </div>
            <button
              type="button"
              className="app-button secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(install);
                  setMessage("Install commands copied.");
                } catch {
                  setMessage("Couldn't copy — select the block manually.");
                }
              }}
            >
              Copy commands
            </button>
          </div>
          <pre className="install-command">{install}</pre>
          <ol style={{ margin: 0, paddingLeft: 18, color: "var(--app-muted)", fontSize: 13 }}>
            <li>
              Open <a href={`/cad/pair${q}`}>Pair desktop</a> after `vantage-cad setup` shows a code.
            </li>
            <li>Approve the desktop for this organization and CAD platform.</li>
            <li>
              {cadTarget === "fusion360"
                ? "Windows/macOS: install the Fusion add-in via scripts/cad/install-fusion-addin.* then keep Fusion + vantage-cad start running. Linux: Fusion unavailable — use Onshape."
                : cadTarget === "onshape"
                  ? "Terminal path: set ONSHAPE_ACCESS_KEY / ONSHAPE_SECRET_KEY in that terminal (or run `vantage-cad login`), then ask Claude Code to bind a Part Studio."
                  : "For the mock path, keep using the deterministic mock adapter until you pair Fusion or connect Onshape."}
            </li>
          </ol>
          <div className="cad-setup-actions">
            <button type="button" className="app-button secondary" onClick={() => setStep(2)}>
              Back
            </button>
            <button className="primary-action" type="button" onClick={() => setStep(4)}>
              Continue to verify
            </button>
            <a className="app-button secondary" href={`/cad/pair${q}`}>
              Pair desktop
            </a>
          </div>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="cad-setup-panel">
          <h2>4. Verify</h2>
          {hostedPath ? (
            <p role="status" className="telemetry-status">
              {onshapeConfigured === false
                ? "Setup required: the Onshape server variables are not set, so no connection can exist yet."
                : onshapeConnected
                  ? `Onshape connected${teamShared ? " and shared with the team" : ""}. Open CAD Builder, bind a Part Studio, and send a brief.`
                  : "No Onshape connection yet. Connect in Connections, then come back — this page refreshes every few seconds."}
            </p>
          ) : online ? (
            <p role="status" className="telemetry-status">
              Paired desktop online: {online.machineName} · {online.platform} · last seen{" "}
              {online.lastSeenAt ? new Date(online.lastSeenAt).toLocaleString() : "now"}
            </p>
          ) : (
            <p role="status" className="telemetry-status">
              Waiting for `vantage-cad start` heartbeat… Open the pair page if setup is unfinished.
            </p>
          )}
          {!hostedPath ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {devices.length === 0 ? <li>No devices paired yet.</li> : null}
              {devices.map((device) => (
                <li key={device.id}>
                  {device.machineName} · {device.platform} ·{" "}
                  {device.revokedAt
                    ? "revoked"
                    : device.lastSeenAt
                      ? `seen ${new Date(device.lastSeenAt).toLocaleString()}`
                      : "never seen"}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="cad-setup-actions">
            <button type="button" className="app-button secondary" onClick={() => setStep(3)}>
              Back
            </button>
            <a className="primary-action" href={`/cad${q}`}>
              Open CAD Builder
            </a>
            <a className="app-button secondary" href={`/cad/connections${q}`}>
              Connections
            </a>
          </div>
        </section>
      ) : null}
    </main>
  );
}
