"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { Button, EmptyState, PageHeader, Panel } from "../../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";

type Run = {
  id: string;
  capability: string;
  status: string;
  provider: string | null;
  model: string | null;
  error: string | null;
  sourceCount: number;
  createdAt: string;
  completedAt: string | null;
  actorName: string | null;
  actorEmail: string | null;
  costUsd: string | null;
  totalTokens: number | null;
};

type Step = {
  sequence: number;
  kind: string;
  status: string | null;
  provenance: unknown[];
  createdAt: string;
};

type Artifact = { id: string; kind: string; title: string; version: number; createdAt: string };

type RunDetail = {
  run: Run & { contextSources: unknown[] };
  steps: Step[];
  artifacts: Artifact[];
};

type View = {
  runs: Run[];
  statusCounts: Array<{ status: string; count: string }>;
};

function featureLabel(capability: string): string {
  switch (capability) {
    case "strategy":
      return "Strategy";
    case "team_intel":
      return "Team intel";
    case "research":
      return "Research";
    case "prediction":
      return "Prediction";
    case "cad":
      return "CAD";
    case "coding":
      return "Code";
    case "maintenance":
      return "Maintenance";
    case "chat":
      return "Ask AI";
    default:
      return capability;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "completed":
      return "Done";
    case "running":
      return "Running";
    case "failed":
    case "error":
      return "Failed";
    default:
      return status;
  }
}

function statusColor(status: string): string | undefined {
  switch (status) {
    case "error":
    case "failed":
      return "var(--critical)";
    case "running":
      return "var(--warning)";
    case "completed":
      return "var(--positive)";
    default:
      return undefined;
  }
}

function money(value: unknown): string {
  return value == null ? "—" : `$${Number(value).toFixed(4)}`;
}

function describeSource(entry: unknown): string {
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    const kind = record.classification ?? record.type ?? record.kind;
    const name = record.source ?? record.label ?? record.name ?? record.tool ?? record.id;
    if (kind || name) return [kind, name].filter(Boolean).join(": ");
    return JSON.stringify(record);
  }
  return String(entry);
}

function isRunsView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const row = value as { runs?: unknown; statusCounts?: unknown };
  return Array.isArray(row.runs) && Array.isArray(row.statusCounts);
}

async function persistRunsSnapshot(orgId: string, data: View): Promise<void> {
  if (!orgId.trim()) return;
  try {
    await putFeatureSnapshot("ai-runs", orgId, data);
  } catch {
    // Live Ask AI history already painted; IndexedDB is best-effort.
  }
}

export default function AiRunsClient({ orgId }: { orgId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<View>("ai-runs", orgId);
      if (!viewRef.current && cached?.data && isRunsView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFailureStatus(null);
    try {
      const response = await fetch(`/api/agent/runs?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFailureStatus(response.status);
        setMessage(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not load Ask AI history.",
        );
        return;
      }
      if (!response.ok || !isRunsView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Ask AI history. Showing the last copy on this device.");
          return;
        }
        setFailureStatus(response.status);
        setMessage(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not load Ask AI history.",
        );
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      await persistRunsSnapshot(orgId, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Ask AI history. Showing the last copy on this device.");
        return;
      }
      setMessage("Could not reach the server.");
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(runId: string) {
    if (openId === runId) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(runId);
    setDetail(null);
    try {
      const response = await fetch(
        `/api/agent/runs?orgId=${encodeURIComponent(orgId)}&runId=${encodeURIComponent(runId)}`,
        { cache: "no-store", signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) },
      );
      const data = (await response.json()) as RunDetail & { error?: string };
      if (response.ok) setDetail(data);
      else setMessage(data.error ?? "Could not load that run.");
    } catch {
      setMessage("Could not load that run.");
    }
  }

  if (message && !view) {
    const failure = loadFailureCopy(
      classifyLoadFailure({
        status: failureStatus,
        message,
        online: typeof navigator === "undefined" ? true : navigator.onLine,
      }),
      {
        nextPath:
          typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`,
        message,
      },
    );
    return (
      <main className="module-page">
        <PageHeader breadcrumbs="Team / Ask AI history" title="Ask AI history" />
        <OfflineBanner feature="Ask AI history" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          badge={failure.kind === "auth" ? "Signed out" : failure.kind === "forbidden" ? "No access" : "Unavailable"}
          badgeTone="setup"
          title={failure.title}
          description={failure.description}
        >
          {failure.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="module-page">
        <PageHeader breadcrumbs="Team / Ask AI history" title="Ask AI history" />
        <OfflineBanner feature="Ask AI history" fromCache={fromCache} cachedAt={cachedAt} />
        <Panel>
          <p className="app-muted">Loading Ask AI history…</p>
        </Panel>
      </main>
    );
  }

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs="Team / Ask AI history"
        title="Ask AI history"
        description="Every Ask AI call for this team, including the ones that failed. Open a run to see the steps and sources that informed the answer."
      >
        <Button as="a" variant="secondary" href={withOrgHref("/ai?tab=chat", orgId)}>
          Ask AI
        </Button>
        <Button as="a" variant="secondary" href={withOrgHref("/team/usage", orgId)}>
          Usage
        </Button>
      </PageHeader>
      <OfflineBanner feature="Ask AI history" fromCache={fromCache} cachedAt={cachedAt} />
      {message ? (
        <p role="status" className="app-muted">
          {message}
        </p>
      ) : null}

      {view.statusCounts.length ? (
        <section className="metric-grid">
          {view.statusCounts.map((row) => (
            <article key={row.status}>
              <span>
                {statusLabel(row.status)} · 30d
              </span>
              <strong style={{ color: statusColor(row.status) }}>{Number(row.count).toLocaleString()}</strong>
            </article>
          ))}
        </section>
      ) : null}

      <section className="intel-panel" style={{ marginTop: "1.5rem" }}>
        <span className="eyebrow">Recent runs · last {view.runs.length}</span>
        {!view.runs.length ? <p className="app-muted">No Ask AI runs recorded yet.</p> : null}
        {view.runs.map((run) => (
          <div key={run.id}>
            <article
              className="admin-org"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}
            >
              <div>
                <strong>
                  {featureLabel(run.capability)} ·{" "}
                  <span style={{ color: statusColor(run.status) }}>{statusLabel(run.status)}</span>
                </strong>
                <small>
                  {run.actorName ?? run.actorEmail ?? "Member"}
                  {run.model ? ` · ${run.provider ?? "hosted"} / ${run.model}` : ""} · {run.sourceCount} source
                  {run.sourceCount === 1 ? "" : "s"} · {new Date(run.createdAt).toLocaleString()}
                  {run.error ? ` · ${run.error}` : ""}
                </small>
              </div>
              <Button variant="secondary" type="button" onClick={() => void toggle(run.id)}>
                {openId === run.id ? "Hide" : "Details"} · {money(run.costUsd)}
              </Button>
            </article>
            {openId === run.id ? (
              <div className="intel-panel" style={{ margin: "0 0 1rem" }}>
                {!detail ? <p className="app-muted">Loading that run…</p> : null}
                {detail && detail.run.id === run.id ? (
                  <>
                    <span className="eyebrow">Sources</span>
                    {!detail.run.contextSources?.length ? (
                      <p className="app-muted">No sources recorded for this run.</p>
                    ) : null}
                    {(detail.run.contextSources ?? []).map((source, index) => (
                      <p key={index} className="app-muted" style={{ margin: "4px 0" }}>
                        · {describeSource(source)}
                      </p>
                    ))}
                    {detail.steps.length ? (
                      <>
                        <span className="eyebrow" style={{ display: "block", marginTop: "1rem" }}>
                          Steps
                        </span>
                        {detail.steps.map((step) => (
                          <p key={step.sequence} className="app-muted" style={{ margin: "4px 0" }}>
                            {step.sequence}. {step.kind}
                            {step.status ? ` · ${statusLabel(step.status)}` : ""}
                            {step.provenance?.length ? ` · ${step.provenance.length} sources` : ""}
                          </p>
                        ))}
                      </>
                    ) : null}
                    {detail.artifacts.length ? (
                      <>
                        <span className="eyebrow" style={{ display: "block", marginTop: "1rem" }}>
                          Saved files
                        </span>
                        {detail.artifacts.map((artifact) => (
                          <p key={artifact.id} className="app-muted" style={{ margin: "4px 0" }}>
                            · {artifact.kind}: {artifact.title} (v{artifact.version})
                          </p>
                        ))}
                      </>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </section>
    </main>
  );
}
