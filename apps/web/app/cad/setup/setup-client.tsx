"use client";
import { Button } from "../../../components/ui";

import { useEffect, useMemo, useState } from "react";
import {
  ONSHAPE_HOSTED_UNCONFIGURED_TITLE,
  ONSHAPE_PLATFORM_HINT_CONFIGURED,
  ONSHAPE_PLATFORM_HINT_UNCONFIGURED,
  onshapeOauthCtaEnabled,
  withLocalPlaywrightHint,
} from "../../../lib/cad/onshape-setup-strings";

const install = `# Windows (recommended one-shot):
# powershell -ExecutionPolicy Bypass -File .\\scripts\\cad\\install-windows.ps1

# Or manual (all OS):
npm install
npm run build --workspace=@vantage/cad-cli
npm install -g ./packages/vantage-cad-cli
npx playwright install chromium
vantage-cad setup
vantage-cad login
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

type Step = 1 | 2 | 3 | 4;

export default function CadSetupWizard({ orgId }: { orgId: string }) {
  const [step, setStep] = useState<Step>(1);
  const [cadTarget, setCadTarget] = useState<"mock" | "fusion360" | "onshape">("onshape");
  const [brain, setBrain] = useState<"mock" | "managed_api" | "terminal_cli" | "team_byok">("terminal_cli");
  const [devices, setDevices] = useState<Device[]>([]);
  const [message, setMessage] = useState("");
  const [onshapeConfigured, setOnshapeConfigured] = useState(false);
  const [onshapeSetupMessage, setOnshapeSetupMessage] = useState("");

  async function load() {
    const response = await fetch(`/api/cad?orgId=${encodeURIComponent(orgId)}`);
    const data = await response.json();
    if (response.ok) {
      setDevices(data.devices ?? []);
      const oauthReady = onshapeOauthCtaEnabled(data.onshape);
      setOnshapeConfigured(oauthReady);
      setOnshapeSetupMessage(
        data.onshape?.setupRequired || !oauthReady
          ? oauthReady
            ? String(data.onshape?.message ?? "Setup required — connect Onshape OAuth in CAD Connections.")
            : "Setup required — set ONSHAPE_OAUTH_CLIENT_ID and ONSHAPE_OAUTH_CLIENT_SECRET on the server. Server API keys do not connect hosted CAD."
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

  const q = `?orgId=${encodeURIComponent(orgId)}`;

  return (
    <main className="module-page cad-setup-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">CAD / Setup</span>
          <h1>Connect CAD + AI brain</h1>
          <p>
            Pick a CAD path and how AI may edit. Shape changes wait for a person to approve. This is not
            certified engineering software.
          </p>
        </div>
        <nav className="cad-header-actions">
          <Button as="a" variant="secondary" href={`/cad${q}`}>
            ← CAD Builder
          </Button>
          <Button as="a" variant="secondary" href={`/cad/connections${q}`}>
            Connections
          </Button>
          <Button as="a" variant="secondary" href={`/cad/pair${q}`}>
            Pair desktop
          </Button>
        </nav>
      </header>

      {message ? (
        <p className="telemetry-status" role="status">
          {message}
        </p>
      ) : null}

      {onshapeSetupMessage && cadTarget === "onshape" ? (
        <aside className="cad-setup-required" role="status">
          <strong>{ONSHAPE_HOSTED_UNCONFIGURED_TITLE}</strong>
          <p>{withLocalPlaywrightHint(onshapeSetupMessage)}</p>
        </aside>
      ) : null}

      <ol className="cad-setup-steps" aria-label="CAD setup progress">
        {["CAD target", "AI brain", "Install & pair", "Verify"].map((label, index) => {
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
            Onshape is the cross-platform live path. Use `vantage-cad login` on a laptop (no API keys), or
            connect hosted Onshape OAuth in CAD Connections. Server keys are CLI last-resort only.
          </p>
          <label className="cad-choice">
            <input type="radio" name="cad" checked={cadTarget === "mock"} onChange={() => setCadTarget("mock")} />
            <span>
              <strong>Mock (recommended first)</strong>
              <small>CI / demo path with deterministic topology + render. No Autodesk or Onshape credentials.</small>
            </span>
          </label>
          <label className="cad-choice">
            <input
              type="radio"
              name="cad"
              checked={cadTarget === "fusion360"}
              onChange={() => setCadTarget("fusion360")}
            />
            <span>
              <strong>Fusion 360 local relay</strong>
              <small>Jobs stay on your machine via vantage-cad + official connector. Vercel never runs Fusion.</small>
            </span>
          </label>
          <label className="cad-choice">
            <input
              type="radio"
              name="cad"
              checked={cadTarget === "onshape"}
              onChange={() => setCadTarget("onshape")}
            />
            <span>
              <strong>Onshape live (recommended)</strong>
              <small>
                {onshapeConfigured ? ONSHAPE_PLATFORM_HINT_CONFIGURED : ONSHAPE_PLATFORM_HINT_UNCONFIGURED}
              </small>
            </span>
          </label>
          <div className="cad-setup-actions">
            <button className="primary-action" type="button" onClick={() => setStep(2)}>
              Continue
            </button>
            <Button as="a" variant="secondary" href={`/cad/connections${q}`}>
              Open Connections
            </Button>
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
              checked={brain === "terminal_cli"}
              onChange={() => setBrain("terminal_cli")}
            />
            <span>
              <strong>Terminal / local CLI</strong>
              <small>
                No Vantage model charge (`key_source=local_cli`). Uses Claude Code / Codex CLI / local OpenAI-compatible
                via your official CLI login — not ChatGPT Plus / Claude Pro scrapes.
              </small>
            </span>
          </label>
          <label className="cad-choice">
            <input
              type="radio"
              name="brain"
              checked={brain === "managed_api"}
              onChange={() => setBrain("managed_api")}
            />
            <span>
              <strong>Vantage managed API</strong>
              <small>Uses your team's Chat credits as usual. See Prompt caching under Chat limits.</small>
            </span>
          </label>
          <label className="cad-choice">
            <input type="radio" name="brain" checked={brain === "team_byok"} onChange={() => setBrain("team_byok")} />
            <span>
              <strong>Team / personal keys</strong>
              <small>Official provider API keys only (encrypted in Admin). Consumer subscriptions are not keys.</small>
            </span>
          </label>
          <label className="cad-choice">
            <input type="radio" name="brain" checked={brain === "mock"} onChange={() => setBrain("mock")} />
            <span>
              <strong>Mock brain</strong>
              <small>Deterministic brief/planner stubs for demos and CI.</small>
            </span>
          </label>
          <div className="cad-setup-actions">
            <Button variant="secondary" type="button" onClick={() => setStep(1)}>
              Back
            </Button>
            <button className="primary-action" type="button" onClick={() => setStep(3)}>
              Continue
            </button>
            {brain === "managed_api" ? (
              <Button as="a" variant="secondary" href={`/team/budgets${q}#prompt-caching`}>
                Prompt caching
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      {step === 3 ? (
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
            <Button variant="secondary" type="button" onClick={async () => { try { await navigator.clipboard.writeText(install); setMessage("Install commands copied."); } catch { setMessage("Couldn't copy — select the block manually."); } }}>
              Copy commands
            </Button>
          </div>
          <pre className="install-command">{install}</pre>
          <ol style={{ margin: 0, paddingLeft: 18, color: "var(--muted)", fontSize: 13 }}>
            <li>
              Open <a href={`/cad/pair${q}`}>Pair desktop</a> after `vantage-cad setup` shows a code.
            </li>
            <li>Approve the desktop for this organization and CAD platform.</li>
            <li>
              {cadTarget === "fusion360"
                ? "Windows/macOS: install Fusion add-in via scripts/cad/install-fusion-addin.* then keep Fusion + vantage-cad start running. Linux: Fusion unavailable — use mock or Onshape."
                : cadTarget === "onshape"
                  ? "Run vantage-cad login, sign in yourself in Chromium, then keep the MCP session open. For hosted execution, connect Onshape OAuth in CAD Connections — server API keys are not a hosted connection."
                  : "For mock path, keep using Deterministic mock in CAD Builder until you pair Fusion."}
            </li>
          </ol>
          <div className="cad-setup-actions">
            <Button variant="secondary" type="button" onClick={() => setStep(2)}>
              Back
            </Button>
            <button className="primary-action" type="button" onClick={() => setStep(4)}>
              Continue to verify
            </button>
            <Button as="a" variant="secondary" href={`/cad/pair${q}`}>
              Pair desktop
            </Button>
          </div>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="cad-setup-panel">
          <h2>4. Verify heartbeat</h2>
          {online ? (
            <p role="status" className="telemetry-status">
              Paired desktop online: {online.machineName} · {online.platform} · last seen{" "}
              {online.lastSeenAt ? new Date(online.lastSeenAt).toLocaleString() : "now"}
            </p>
          ) : (
            <p role="status" className="telemetry-status">
              Waiting for `vantage-cad start` heartbeat… Open the pair page if setup is unfinished.
            </p>
          )}
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
          <div className="cad-setup-actions">
            <Button variant="secondary" type="button" onClick={() => setStep(3)}>
              Back
            </Button>
            <a className="primary-action" href={`/cad${q}`}>
              Open CAD Builder
            </a>
            <Button as="a" variant="secondary" href={`/cad/connections${q}`}>
              Connections
            </Button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
