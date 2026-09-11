"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { Button, EmptyState, PageHeader } from "../../../components/ui";
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

async function persistBridgeSnapshot(orgId: string, data: StatusPayload): Promise<void> {
  if (data.error) return;
  try {
    await putFeatureSnapshot("ai-bridge", orgId, data);
  } catch {
    // Live bridge already painted; IndexedDB is best-effort.
  }
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
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const paintedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!orgId) {
      setStatus(null);
      setLoading(false);
      paintedRef.current = false;
      return;
    }
    let hadCache = paintedRef.current;
    try {
      const cached = await getFeatureSnapshot<StatusPayload>("ai-bridge", orgId);
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
      if (response.status === 401 || response.status === 403) {
        paintedRef.current = false;
        setStatus({
          error:
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Could not load the subscription bridge.",
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
              : "Could not load the subscription bridge. Check your connection and retry.",
        });
        setLoading(false);
        return;
      }
      setStatus(data);
      paintedRef.current = true;
      setFromCache(false);
      setCachedAt(null);
      setLoading(false);
      await persistBridgeSnapshot(orgId, data);
    } catch {
      if (hadCache || paintedRef.current) {
        setFromCache(true);
        setLoading(false);
        return;
      }
      setStatus({ error: "Could not load the subscription bridge. Check your connection and retry." });
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
        ? `${data.machineName} is paired. Return to that computer — the bridge starts serving once it checks in.`
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
  const showStatusError = Boolean(status?.error) && !fromCache && !(status?.devices?.length);

  return (
    <main className="module-page ai-bridge-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href="/team">Team</a>
            {" / AI subscription bridge"}
          </>
        }
        title="AI subscription bridge"
        description="One mentor or member who already pays for Claude or ChatGPT can run the team's AI from their own computer. Chat is the default; they can widen that. Those turns cost the team $0 in API usage."
      />
      <OfflineBanner fromCache={fromCache} cachedAt={cachedAt} feature="AI subscription bridge" />

      {organizations.length === 0 ? (
        <EmptyState
          soft
          badge="Setup"
          badgeTone="setup"
          title="Choose your team"
          description="Join or create a team before pairing a bridge."
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
                <li>On the always-on computer, sign in to Claude or ChatGPT.</li>
                <li>Run the bridge app — it prints an 8-character code.</li>
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
              <Button variant="primary" type="submit" disabled={!orgId}>
                Approve pairing
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
                <p className="app-muted">Loading bridge status…</p>
              ) : showStatusError ? (
                <p className="telemetry-status">{status?.error}</p>
              ) : status?.setupRequired ? (
                <p className="app-muted">This team isn&apos;t ready for a bridge yet. Ask a mentor to finish setup.</p>
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
                          ? `Last heard ${new Date(device.lastHeartbeatAt).toLocaleString()}`
                          : "Not heard from yet — start the bridge on that computer"}
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
                              Everything — run all of Vantage&apos;s AI on this subscription
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
                <strong>This uses the pairer&apos;s subscription on the pairer&apos;s computer.</strong> Every bridged turn
                draws from that person&apos;s Claude or ChatGPT plan — not a team pool.
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
                When the provider says you hit a limit, Vantage shows that message (including any reset time) and the
                turn <strong>falls back to the team&apos;s configured AI keys</strong>. Nothing here is unlimited.
              </li>
              <li>
                By default only interactive chat-class features use the bridge
                {status?.bridgeFeatures?.length ? ` (${status.bridgeFeatures.join(", ")})` : ""}. The pairer can widen
                that to <strong>Everything</strong> above — then all of Vantage&apos;s AI, including long jobs like season
                reports and nightly summaries, runs on their subscription while the bridge is online.
              </li>
              <li>
                Prompts for bridged turns include team context and are executed on the pairer&apos;s computer. Revoke the
                device here at any time to stop that immediately.
              </li>
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
