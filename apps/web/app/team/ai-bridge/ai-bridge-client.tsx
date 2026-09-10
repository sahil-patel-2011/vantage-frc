"use client";
import { Button } from "../../../components/ui";

import { useCallback, useEffect, useState } from "react";

type Org = { id: string; name: string; role: string };

type EngineReport = { available?: boolean; version?: string | null; authenticated?: boolean | null };

type Device = {
  id: string;
  name: string;
  pairedByMe: boolean;
  online: boolean;
  lastHeartbeatAt: string | null;
  engines: Record<string, EngineReport>;
  bridgeVersion: string | null;
  preferWhenOnline: boolean;
  coverage: "chat" | "everything";
  jobsServed: number;
  canManage: boolean;
};

type JobStat = { state: string; count: number; lastAt: string | null };

type StatusPayload = {
  devices?: Device[];
  jobStats?: JobStat[];
  bridgeFeatures?: string[];
  setupRequired?: boolean;
  error?: string;
};

const ENGINE_LABELS: Record<string, { name: string; plan: string }> = {
  claude: { name: "Claude Code", plan: "Claude Pro/Max subscription" },
  codex: { name: "Codex CLI", plan: "ChatGPT subscription (experimental)" },
};

function engineLine(id: string, report: EngineReport): string {
  const meta = ENGINE_LABELS[id] ?? { name: id, plan: "" };
  if (!report.available) return `${meta.name}: not installed`;
  const auth =
    report.authenticated === true
      ? "signed in"
      : report.authenticated === false
        ? "NOT signed in — run its login on that machine"
        : "sign-in state unknown";
  return `${meta.name} ${report.version ?? ""} · ${auth}`;
}

export default function AiBridgeClient({
  initialCode,
  initialOrgId,
  organizations,
}: {
  initialCode: string;
  initialOrgId: string | null;
  organizations: Org[];
}) {
  const [orgId, setOrgId] = useState(
    initialOrgId && organizations.some((org) => org.id === initialOrgId)
      ? initialOrgId
      : (organizations[0]?.id ?? ""),
  );
  const [code, setCode] = useState(initialCode);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!orgId) {
      setStatus(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/ai-bridge/status?orgId=${encodeURIComponent(orgId)}`);
      setStatus((await response.json()) as StatusPayload);
    } catch {
      setStatus({ error: "Bridge status could not be loaded. Check your connection and retry." });
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function approve(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/ai-bridge/pair/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, orgId }),
    });
    const data = (await response.json()) as { machineName?: string; error?: string };
    setMessage(
      response.ok
        ? `${data.machineName} is paired. Return to that machine's terminal — the bridge starts serving once it heartbeats.`
        : (data.error ?? "Pairing approval failed"),
    );
    if (response.ok) {
      setCode("");
      void refresh();
    }
  }

  async function patchDevice(deviceId: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/ai-bridge/status?orgId=${encodeURIComponent(orgId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId, ...body }),
    });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setMessage(data.error ?? "Update failed");
    }
    void refresh();
  }

  const doneJobs = status?.jobStats?.find((row) => row.state === "done")?.count ?? 0;
  const failedJobs =
    (status?.jobStats?.find((row) => row.state === "failed")?.count ?? 0) +
    (status?.jobStats?.find((row) => row.state === "expired")?.count ?? 0);

  return (
    <main className="module-page ai-bridge-page">
      <header>
        <span className="breadcrumbs">Team / AI subscription bridge</span>
        <h1>AI subscription bridge</h1>
        <p className="app-muted">
          One mentor or member who already pays for Claude Pro/Max (Claude Code) or ChatGPT (Codex CLI) can serve the
          team&apos;s AI from their own machine — interactive chat by default, or the entire platform if they choose —
          and those turns cost the team $0 in API usage.
        </p>
      </header>

      {organizations.length === 0 ? (
        <p className="telemetry-status" role="status">
          You aren&apos;t a member of any team yet — join or create one before pairing a bridge.
        </p>
      ) : (
        <>
          {organizations.length > 1 ? (
            <label className="ai-bridge-org">
              Team
              <select value={orgId} onChange={(event) => setOrgId(event.target.value)}>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name} · {org.role}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <section className="ai-bridge-grid">
            <form className="ai-bridge-card" onSubmit={approve}>
              <h2>Pair a machine</h2>
              <ol className="ai-bridge-steps">
                <li>
                  On the always-on computer, install the CLI you subscribe to and sign in (<code>claude auth login</code>{" "}
                  or <code>codex login</code>).
                </li>
                <li>
                  Run <code>node bridge.mjs --setup</code> (see <code>docs/AI_BRIDGE.md</code>) and it prints an 8-character
                  code.
                </li>
                <li>Enter that code here. Only approve a code shown on a computer you control.</li>
              </ol>
              <label>
                Pairing code
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  pattern="[A-Z0-9-]{8,9}"
                  placeholder="ABCD-EFGH"
                  required
                  autoComplete="one-time-code"
                />
              </label>
              <button className="primary-action" type="submit" disabled={!orgId}>
                Approve pairing
              </button>
              {message ? (
                <p role="status" className="telemetry-status">
                  {message}
                </p>
              ) : null}
            </form>

            <section className="ai-bridge-card" aria-label="Bridge status">
              <h2>Status</h2>
              {loading ? (
                <p className="app-muted">Loading bridge status…</p>
              ) : status?.error ? (
                <p className="telemetry-status">{status.error}</p>
              ) : status?.setupRequired ? (
                <p className="app-muted">
                  The bridge tables aren&apos;t migrated on this deployment yet — run the 0486 migration first.
                </p>
              ) : !status?.devices?.length ? (
                <p className="app-muted">No bridge paired yet. Chat keeps using the team&apos;s configured AI keys.</p>
              ) : (
                <ul className="ai-bridge-devices">
                  {status.devices.map((device) => (
                    <li key={device.id}>
                      <div className="ai-bridge-device-head">
                        <strong>{device.name}</strong>
                        <span className={device.online ? "ai-bridge-dot online" : "ai-bridge-dot"}>
                          {device.online ? "Online" : "Offline"}
                        </span>
                      </div>
                      <p className="app-muted ai-bridge-meta">
                        {device.lastHeartbeatAt
                          ? `Last heartbeat ${new Date(device.lastHeartbeatAt).toLocaleString()}`
                          : "No heartbeat yet — start the bridge on that machine"}
                        {" · "}
                        {device.jobsServed} job{device.jobsServed === 1 ? "" : "s"} served
                        {device.bridgeVersion ? ` · bridge v${device.bridgeVersion}` : ""}
                      </p>
                      <ul className="ai-bridge-engines">
                        {Object.keys(ENGINE_LABELS).map((engineId) => (
                          <li key={engineId}>{engineLine(engineId, device.engines[engineId] ?? { available: false })}</li>
                        ))}
                      </ul>
                      {device.canManage ? (
                        <div className="ai-bridge-actions">
                          <label className="ai-bridge-toggle">
                            <input
                              type="checkbox"
                              checked={device.preferWhenOnline}
                              onChange={(event) => void patchDevice(device.id, { preferWhenOnline: event.target.checked })}
                            />
                            Prefer this bridge while it&apos;s online
                          </label>
                          <fieldset className="ai-bridge-coverage">
                            <legend>What runs on this subscription</legend>
                            <label className="ai-bridge-toggle">
                              <input
                                type="radio"
                                name={`coverage-${device.id}`}
                                checked={device.coverage !== "everything"}
                                onChange={() => void patchDevice(device.id, { coverage: "chat" })}
                              />
                              Interactive chat only (chat, writer, troubleshooting)
                            </label>
                            <label className="ai-bridge-toggle">
                              <input
                                type="radio"
                                name={`coverage-${device.id}`}
                                checked={device.coverage === "everything"}
                                onChange={() => void patchDevice(device.id, { coverage: "everything" })}
                              />
                              Everything — run ALL of Vantage&apos;s AI on this subscription
                            </label>
                            {device.coverage === "everything" ? (
                              <p className="app-muted ai-bridge-meta">
                                Every AI feature — chat, season reports, CAD plans, nightly summaries — now draws from
                                this plan&apos;s usage window while the bridge is online. Long jobs use it faster; when the
                                plan hits its limit, features fall back to the team&apos;s keys until it resets.
                              </p>
                            ) : null}
                          </fieldset>
                          <Button variant="secondary" type="button" onClick={() => void patchDevice(device.id, { revoke: true })}>
                            Revoke
                          </Button>
                        </div>
                      ) : (
                        <p className="app-muted ai-bridge-meta">Managed by the member who paired it (or an owner/admin).</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {status?.devices?.length ? (
                <p className="app-muted ai-bridge-meta">
                  Last 7 days: {doneJobs} served, {failedJobs} failed or expired (failures fall back to the team&apos;s
                  keys automatically).
                </p>
              ) : null}
            </section>
          </section>

          <section className="ai-bridge-card ai-bridge-terms" aria-label="Terms and limits">
            <h2>Honest terms &amp; limits</h2>
            <ul>
              <li>
                <strong>This uses the pairer&apos;s subscription on the pairer&apos;s machine.</strong> Every bridged turn
                draws from that person&apos;s Claude Pro/Max or ChatGPT plan — not a team pool.
              </li>
              <li>
                Subscription plans have <strong>usage windows and rate limits</strong>, and their own terms apply:{" "}
                <a href="https://www.anthropic.com/legal/consumer-terms" target="_blank" rel="noreferrer">
                  Anthropic consumer terms
                </a>{" "}
                ·{" "}
                <a href="https://openai.com/policies/terms-of-use" target="_blank" rel="noreferrer">
                  OpenAI terms of use
                </a>
                . Review whether bridged team use fits your plan before pairing.
              </li>
              <li>
                When the CLI reports a rate limit, Vantage shows the provider&apos;s message (including any reset time) and
                the turn <strong>falls back to the team&apos;s configured AI keys</strong>. Nothing here is unlimited.
              </li>
              <li>
                By default only interactive chat-class features use the bridge
                {status?.bridgeFeatures?.length ? ` (${status.bridgeFeatures.join(", ")})` : ""}. The pairer can widen
                that to <strong>Everything</strong> above — then all of Vantage&apos;s AI, including long jobs like season
                reports and nightly summaries, runs on their subscription while the bridge is online.
              </li>
              <li>
                Prompts for bridged turns include team context and are executed on the pairer&apos;s machine. Revoke the
                device here at any time to stop that immediately.
              </li>
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
