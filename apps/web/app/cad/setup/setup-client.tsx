"use client";

import { useEffect, useMemo, useState } from "react";

const install = `npm install
npm run build --workspace=@vantage/cad-cli
npm install -g ./packages/vantage-cad-cli
vantage-cad setup
# Optional CI/demo without Fusion:
# set VANTAGE_CAD_MOCK=1
vantage-cad start`;

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
  const [cadTarget, setCadTarget] = useState<"mock" | "fusion360" | "onshape">("mock");
  const [brain, setBrain] = useState<"mock" | "managed_api" | "terminal_cli" | "team_byok">("terminal_cli");
  const [devices, setDevices] = useState<Device[]>([]);
  const [message, setMessage] = useState("");
  const [onshapeConfigured, setOnshapeConfigured] = useState(false);

  async function load() {
    const response = await fetch(`/api/cad?orgId=${encodeURIComponent(orgId)}`);
    const data = await response.json();
    if (response.ok) {
      setDevices(data.devices ?? []);
      setOnshapeConfigured(Boolean(data.onshapeConfigured));
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

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">CAD / SETUP WIZARD</span>
          <h1>Connect CAD + AI brain</h1>
          <p>
            Pick a CAD path and an AI execution mode. Geometry mutations stay allowlisted and approval-gated. This is not
            certified engineering software.
          </p>
        </div>
        <nav className="intel-actions">
          <a href={`/cad?orgId=${orgId}`}>← CAD Builder</a>
          <a href={`/cad/connections?orgId=${orgId}`}>Connections</a>
          <a href={`/cad/pair?orgId=${orgId}`}>Pair desktop</a>
        </nav>
      </header>

      {message ? (
        <p className="telemetry-status" role="status">
          {message}
        </p>
      ) : null}

      <ol className="onboarding-steps" aria-label="CAD setup progress">
        {["CAD target", "AI brain", "Install & pair", "Verify"].map((label, index) => (
          <li key={label} className={index < step ? "active" : undefined} aria-current={index + 1 === step ? "step" : undefined}>
            <b>{index + 1}</b>
            <span>{label}</span>
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <section className="intel-panel">
          <h2>1. CAD platform</h2>
          <label className="state-control">
            <input type="radio" name="cad" checked={cadTarget === "mock"} onChange={() => setCadTarget("mock")} />
            <span>
              <strong>Mock (recommended first)</strong>
              <small>CI / demo path with deterministic topology + render. No Autodesk or Onshape credentials.</small>
            </span>
          </label>
          <label className="state-control">
            <input type="radio" name="cad" checked={cadTarget === "fusion360"} onChange={() => setCadTarget("fusion360")} />
            <span>
              <strong>Fusion 360 local relay</strong>
              <small>Jobs stay on your machine via vantage-cad + official connector. Vercel never runs Fusion.</small>
            </span>
          </label>
          <label className="state-control">
            <input
              type="radio"
              name="cad"
              checked={cadTarget === "onshape"}
              onChange={() => setCadTarget("onshape")}
              disabled={!onshapeConfigured}
            />
            <span>
              <strong>Onshape hosted OAuth</strong>
              <small>
                {onshapeConfigured
                  ? "Hosted cloud CAD via OAuth — connect in Connections, then select document refs."
                  : "Setup required — OAuth client env not configured yet."}
              </small>
            </span>
          </label>
          <button className="primary-action" type="button" onClick={() => setStep(2)}>
            Continue
          </button>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="intel-panel">
          <h2>2. AI brain / billing path</h2>
          <label className="state-control">
            <input type="radio" name="brain" checked={brain === "terminal_cli"} onChange={() => setBrain("terminal_cli")} />
            <span>
              <strong>Terminal / local CLI</strong>
              <small>
                No Vantage model charge (`key_source=local_cli`). Uses Claude Code / Codex CLI / local OpenAI-compatible via
                your official CLI login — not ChatGPT Plus / Claude Pro scrapes.
              </small>
            </span>
          </label>
          <label className="state-control">
            <input type="radio" name="brain" checked={brain === "managed_api"} onChange={() => setBrain("managed_api")} />
            <span>
              <strong>Vantage managed API</strong>
              <small>Meters Vantage credits / org limits as usual.</small>
            </span>
          </label>
          <label className="state-control">
            <input type="radio" name="brain" checked={brain === "team_byok"} onChange={() => setBrain("team_byok")} />
            <span>
              <strong>Team / personal BYOK API</strong>
              <small>Official provider API keys only (encrypted in Admin). Consumer subscriptions are not keys.</small>
            </span>
          </label>
          <label className="state-control">
            <input type="radio" name="brain" checked={brain === "mock"} onChange={() => setBrain("mock")} />
            <span>
              <strong>Mock brain</strong>
              <small>Deterministic brief/planner stubs for demos and CI.</small>
            </span>
          </label>
          <div className="onboarding-actions">
            <button type="button" className="signin-link" onClick={() => setStep(1)}>
              Back
            </button>
            <button className="primary-action" type="button" onClick={() => setStep(3)}>
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="intel-panel">
          <h2>3. Install commands</h2>
          <p>
            Target: <strong>{cadTarget}</strong> · Brain: <strong>{brain}</strong>
          </p>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">WINDOWS / MACOS / LINUX</span>
              <h3>vantage-cad CLI</h3>
            </div>
            <button
              type="button"
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
          <ol>
            <li>
              Open <a href={`/cad/pair?orgId=${orgId}`}>/cad/pair</a> after `vantage-cad setup` shows a code.
            </li>
            <li>Approve the desktop for this organization and CAD platform.</li>
            <li>
              {cadTarget === "fusion360"
                ? "Windows/macOS: install Fusion add-in via scripts/cad/install-fusion-addin.* then keep Fusion + vantage-cad start running. Linux: Fusion unavailable — use mock or Onshape."
                : cadTarget === "onshape"
                  ? "Authorize Onshape in Connections, select document/workspace/element in CAD Builder. CLI monitor optional."
                  : "For mock path, keep using Deterministic mock in CAD Builder until you pair Fusion."}
            </li>
          </ol>
          <div className="onboarding-actions">
            <button type="button" className="signin-link" onClick={() => setStep(2)}>
              Back
            </button>
            <button className="primary-action" type="button" onClick={() => setStep(4)}>
              Continue to verify
            </button>
          </div>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="intel-panel">
          <h2>4. Verify heartbeat</h2>
          {online ? (
            <p role="status" className="telemetry-status success">
              Paired desktop online: {online.machineName} · {online.platform} · last seen{" "}
              {online.lastSeenAt ? new Date(online.lastSeenAt).toLocaleString() : "now"}
            </p>
          ) : (
            <p role="status" className="telemetry-status">
              Waiting for `vantage-cad start` heartbeat… Open the pair page if setup is unfinished.
            </p>
          )}
          <ul>
            {devices.length === 0 ? <li>No devices paired yet.</li> : null}
            {devices.map((device) => (
              <li key={device.id}>
                {device.machineName} · {device.platform} ·{" "}
                {device.revokedAt ? "revoked" : device.lastSeenAt ? `seen ${new Date(device.lastSeenAt).toLocaleString()}` : "never seen"}
              </li>
            ))}
          </ul>
          <div className="onboarding-actions">
            <button type="button" className="signin-link" onClick={() => setStep(3)}>
              Back
            </button>
            <a className="primary-action" href={`/cad?orgId=${orgId}`}>
              Open CAD Builder
            </a>
          </div>
        </section>
      ) : null}
    </main>
  );
}
