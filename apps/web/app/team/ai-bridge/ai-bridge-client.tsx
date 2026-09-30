"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { Button, EmptyState, PageHeader } from "../../../components/ui";
import {
  AI_BRIDGE_FEATURE_LABEL,
  AI_BRIDGE_SETUP_STEPS,
  AI_BRIDGE_TITLE,
  aiBridgeShellCopy,
} from "../../../lib/ai-bridge/ai-bridge-related";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";

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
  claude: { name: "Claude", plan: "Claude Pro/Max" },
  codex: { name: "ChatGPT", plan: "ChatGPT" },
};

function engineLine(id: string, report: EngineReport): string {
  const meta = ENGINE_LABELS[id] ?? { name: id, plan: "" };
  if (!report.available) return `${meta.name}: not installed`;
  const auth =
    report.authenticated === true
      ? "signed in"
      : report.authenticated === false
        ? "not signed in on that computer"
        : "sign-in unknown";
  return `${meta.name} ${report.version ?? ""} · ${auth}`;
}

function isStatusPayload(value: unknown): value is StatusPayload {
  if (!value || typeof value !== "object") return false;
  const row = value as StatusPayload;
  return (
    Array.isArray(row.devices) ||
    Array.isArray(row.jobStats) ||
    row.setupRequired === true ||
    typeof row.error === "string"
  );
}

async function persistBridgeSnapshot(cacheScope: string, data: StatusPayload): Promise<void> {
  if (data.error) return;
  try {
    await putFeatureSnapshot("ai-bridge", cacheScope, data);
  } catch {
    // Live bridge already painted; IndexedDB is best-effort.
  }
}

export default function AiBridgeClient({
  userId,
  initialCode,
  initialOrgId,
  organizations,
}: {
  userId: string;
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
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const paintedRef = useRef(false);
  const refreshSequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const cacheScope = `${userId}:${orgId}`;

  const refresh = useCallback(async () => {
    const requestId = ++refreshSequence.current;
    const isCurrent = () => requestId === refreshSequence.current;
    if (!orgId) {
      setStatus(null);
      setLoading(false);
      paintedRef.current = false;
      return;
    }
    let hadCache = paintedRef.current;
    try {
      const cached = await getFeatureSnapshot<StatusPayload>("ai-bridge", cacheScope);
      if (!isCurrent()) return;
      if (cached?.data && isStatusPayload(cached.data) && !cached.data.error) {
        if (!paintedRef.current) {
          setStatus(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          setLoading(false);
          paintedRef.current = true;
          hadCache = true;
        }
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    if (!hadCache) setLoading(true);
    try {
      const response = await fetch(`/api/ai-bridge/status?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!isCurrent()) return;
      if (response.status === 401 || response.status === 403) {
        paintedRef.current = false;
        setStatus({
          error:
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Could not load your personal connection.",
        });
        setFromCache(false);
        setCachedAt(null);
        setLoading(false);
        return;
      }
      if (!response.ok || !isStatusPayload(data) || data.error) {
        if (hadCache || paintedRef.current) {
          setFromCache(true);
          setLoading(false);
          return;
        }
        setStatus({
          error:
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Could not load your personal connection. Check your connection and retry.",
        });
        setLoading(false);
        return;
      }
      setStatus(data);
      paintedRef.current = true;
      setFromCache(false);
      setCachedAt(null);
      setLoading(false);
      await persistBridgeSnapshot(cacheScope, data);
    } catch {
      if (!isCurrent()) return;
      if (hadCache || paintedRef.current) {
        setFromCache(true);
        setLoading(false);
        return;
      }
      setStatus({ error: "Could not load your personal connection. Check your connection and retry." });
      setLoading(false);
    }
  }, [orgId, cacheScope]);

  useEffect(() => {
    void refresh();
    return () => { refreshSequence.current++; };
  }, [refresh]);

  async function approve(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
    const response = await fetch("/api/ai-bridge/pair/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, orgId }),
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    const data = (await response.json()) as { machineName?: string; error?: string };
    setMessage(
      response.ok
        ? `${data.machineName} is paired to your account. Sign in and test your Codex profile, then leave the connector running.`
        : (data.error ?? "Could not approve that code"),
    );
    if (response.ok) {
      setCode("");
      void refresh();
    }
    } catch { setMessage("Could not reach Vantage. Check your connection and retry the pairing code."); }
    finally { setBusy(false); }
  }

  async function patchDevice(deviceId: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
    const response = await fetch(`/api/ai-bridge/status?orgId=${encodeURIComponent(orgId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId, ...body }),
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setMessage(data.error ?? "Update failed");
    }
    void refresh();
    } catch { setMessage("Could not update your connection. Check your connection and retry."); }
    finally { setBusy(false); }
  }

  const doneJobs = status?.jobStats?.find((row) => row.state === "done")?.count ?? 0;
  const failedJobs =
    (status?.jobStats?.find((row) => row.state === "failed")?.count ?? 0) +
    (status?.jobStats?.find((row) => row.state === "expired")?.count ?? 0);
  const showStatusError = Boolean(status?.error) && !fromCache && !(status?.devices?.length);

  return (
    <main className="module-page ai-bridge-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href="/team">Team</a>
            {` / ${AI_BRIDGE_TITLE}`}
          </>
        }
        title={AI_BRIDGE_TITLE}
        description="Use your own Codex account and computer for your Vantage requests. Your terminal conversations stay separate."
      />
      <OfflineBanner fromCache={fromCache} cachedAt={cachedAt} feature={AI_BRIDGE_FEATURE_LABEL} />

      {organizations.length === 0 ? (
        <EmptyState
          soft
          badge={aiBridgeShellCopy("no-team").badge}
          badgeTone="setup"
          title={aiBridgeShellCopy("no-team").title}
          description={aiBridgeShellCopy("no-team").description}
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      ) : (
        <>
          {organizations.length > 1 ? (
            <label className="ai-bridge-org">
              Team
              <select value={orgId} onChange={(event) => {
                refreshSequence.current++;
                paintedRef.current = false;
                setStatus(null); setLoading(true); setFromCache(false); setCachedAt(null); setMessage("");
                setOrgId(event.target.value);
              }}>
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
              <h2>Pair this computer</h2>
              <ol className="ai-bridge-steps">
                {AI_BRIDGE_SETUP_STEPS.map((step, index) => (
                  <li key={step}>
                    {step}
                    {index === 1 ? <ConnectorCommands userId={userId} /> : null}
                  </li>
                ))}
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
              <Button variant="primary" type="submit" disabled={!orgId || busy}>
                Approve this computer
              </Button>
              {message ? (
                <p role="status" className="telemetry-status">
                  {message}
                </p>
              ) : null}
            </form>

            <section className="ai-bridge-card" aria-label="Bridge status">
              <h2>Status</h2>
              {loading && !status ? (
                <p className="app-muted">Loading your connection…</p>
              ) : showStatusError ? (
                <p className="telemetry-status">{status?.error}</p>
              ) : status?.setupRequired ? (
                <p className="app-muted">This team is not ready to pair yet. Ask a mentor to finish team setup.</p>
              ) : !status?.devices?.length ? (
                <p className="app-muted">No computer paired yet. Follow the three steps, then approve the code.</p>
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
                          ? `Last heard ${new Date(device.lastHeartbeatAt).toLocaleString()}`
                          : "Not heard from yet — keep your connector running"}
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
                              disabled={busy || fromCache}
                              checked={device.preferWhenOnline}
                              onChange={(event) => void patchDevice(device.id, { preferWhenOnline: event.target.checked })}
                            />
                            Use this computer while it is online
                          </label>
                          <fieldset className="ai-bridge-coverage">
                            <legend>What this computer answers</legend>
                            <label className="ai-bridge-toggle">
                              <input
                                type="radio"
                                disabled={busy || fromCache}
                                name={`coverage-${device.id}`}
                                checked={device.coverage !== "everything"}
                                onChange={() => void patchDevice(device.id, { coverage: "chat" })}
                              />
                              Interactive chat only (chat, writer, troubleshooting)
                            </label>
                            <label className="ai-bridge-toggle">
                              <input
                                type="radio"
                                disabled={busy || fromCache}
                                name={`coverage-${device.id}`}
                                checked={device.coverage === "everything"}
                                onChange={() => void patchDevice(device.id, { coverage: "everything" })}
                              />
                              All supported AI requests you submit
                            </label>
                            {device.coverage === "everything" ? (
                              <p className="app-muted ai-bridge-meta">
                                Your supported requests use this connection while it is online. Long requests
                                use your provider&apos;s limits faster. Team background jobs use the configured
                                team providers. An available provider may handle your request if this connection fails.
                              </p>
                            ) : null}
                          </fieldset>
                          <Button variant="secondary" type="button" disabled={busy || fromCache} onClick={() => void patchDevice(device.id, { revoke: true })}>
                            Revoke
                          </Button>
                        </div>
                      ) : (
                        <p className="app-muted ai-bridge-meta">Only the person who paired this connection can manage it.</p>
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

          <section className="ai-bridge-card ai-bridge-terms" aria-label="What this uses">
            <h2>What this uses</h2>
            <ul>
              <li>
                <strong>This is your account on your computer.</strong> Other teammates cannot use your connection.
              </li>
              <li>
                Plans have usage windows. Their terms apply:{" "}
                <a href="https://www.anthropic.com/legal/consumer-terms" target="_blank" rel="noreferrer">
                  Anthropic consumer terms
                </a>{" "}
                ·{" "}
                <a href="https://openai.com/policies/terms-of-use" target="_blank" rel="noreferrer">
                  OpenAI terms of use
                </a>
                .
              </li>
              <li>
                When the plan hits a limit, Ask AI shows that message and falls back to the team&apos;s keys if any
                exist.
              </li>
              <li>
                Your computer can answer chat, writing and troubleshooting. You can also enable other supported
                requests you submit, including season reports.
              </li>
              <li>Revoke the computer here to stop sending your requests to it.</li>
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

/**
 * The connector is one file (packages/ai-bridge/bridge.mjs, copied to public/ and kept equal by
 * a unit test). Step 2 used to say "start the connector" with no way to get it.
 */
function ConnectorCommands({ userId }: { userId: string }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  const host = origin || "https://vantagefrc.vercel.app";
  const commands = [
    `curl -fsSLo vantage-ai-bridge.mjs ${host}/vantage-ai-bridge.mjs`,
    `node vantage-ai-bridge.mjs --profile ${userId} --setup --url ${host}`,
    `node vantage-ai-bridge.mjs --profile ${userId} --codex-login`,
    `node vantage-ai-bridge.mjs --profile ${userId} --test`,
    `node vantage-ai-bridge.mjs --profile ${userId}`,
  ].join("\n");
  return (
    <div className="ai-bridge-commands">
      <pre aria-label="Connector commands">{commands}</pre>
      <div>
        <Button
          variant="secondary"
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(commands).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {copied ? "Copied" : "Copy commands"}
        </Button>
        <a href="/vantage-ai-bridge.mjs" download>
          Download the connector
        </a>
      </div>
      <small className="app-muted">Approve the pairing code before signing in. The test checks your personal Codex sign-in and Vantage connection. Each person uses their own user ID in the --profile command.</small>
      <details>
        <summary data-disclosure>Connect your Codex terminal to Vantage</summary>
        <p>After pairing, register this connector with Codex. Replace the quoted path with the full path to your downloaded file.</p>
        <pre aria-label="Codex MCP command">{`codex mcp add vantage -- node "/full/path/to/vantage-ai-bridge.mjs" --profile ${userId} --mcp`}</pre>
        <small className="app-muted">These tools use your Vantage permissions. Purchase requests and CAD briefs wait for your confirmation in Vantage.</small>
      </details>
    </div>
  );
}
