"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import { acknowledgmentAgeMinutes, degradedModeReasonLabel, degradedModeSourceLabel } from "../../lib/degraded-mode";
import type { DegradedModeView } from "../../lib/degraded-mode/compute-degraded-mode";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type LiveView = Extract<DegradedModeView, { status: "live" }>;

function modeTone(mode: LiveView["health"]["mode"]): string {
  if (mode === "ok") return "good";
  if (mode === "stale") return "setup";
  return "demo";
}

function isDegradedModeView(value: unknown): value is DegradedModeView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function degradedModeCacheOrg(data: DegradedModeView, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return (typeof data.orgId === "string" && data.orgId.trim()) || orgHint;
    case "live":
      return data.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistDegradedModeSnapshot(orgHint: string, data: DegradedModeView): Promise<void> {
  const cacheOrg = degradedModeCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("degraded-mode", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("degraded-mode", "_", data);
  } catch {
    // Live Data-source health already painted; IndexedDB is best-effort.
  }
}

function DataSourceHealthRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related team tools">
      <Button as="a" variant="secondary" href={withOrgHref("/team/data", orgId)}>
        Team Data
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/rankings", orgId)}>
        Rankings
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/schedule", orgId)}>
        Schedule
      </Button>
    </nav>
  );
}

function DataSourceHealthNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "data",
      label: "Open Team Data",
      detail: "The last saved schedule and rankings live on Team Data.",
      href: withOrgHref("/team/data", orgId),
      primary: true,
    },
    {
      id: "rankings",
      label: "Open Rankings",
      detail: "Check whether the current ranking board is using the last saved copy.",
      href: withOrgHref("/rankings", orgId),
      primary: false,
    },
    {
      id: "schedule",
      label: "Open Schedule",
      detail: "Match times stay on the last saved copy when the live source is stale.",
      href: withOrgHref("/schedule", orgId),
      primary: false,
    },
  ];
  return (
    <section className="app-card soft-panel edc-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function DegradedModeClient() {
  const [view, setView] = useState<DegradedModeView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<DegradedModeView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<DegradedModeView>("degraded-mode", orgHint || "_");
      if (!viewRef.current && cached?.data && isDegradedModeView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setError("");
    setLoadError("");
    setErrorStatus(null);
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      const response = await fetch(`/api/degraded-mode${query.toString() ? `?${query.toString()}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(responseError(data));
        return;
      }
      if (!response.ok || !isDegradedModeView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Data-source health. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(responseError(data));
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistDegradedModeSnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Data-source health. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/degraded-mode", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isDegradedModeView(data)) {
          setError(responseError(data) || "Something went wrong.");
          return;
        }
        setView(data);
        setFromCache(false);
        void persistDegradedModeSnapshot(orgId, data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  const teamHref = orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={teamHref}>Team</a>
          {" / Data-source health"}
        </>
      }
      title="Data-source health"
      description="See whether the schedule and rankings this team uses are up to date, and what the app falls back to when they are not."
    >
      <DataSourceHealthRelated orgId={orgId} />
    </PageHeader>
  );

  if (!view) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: loadError,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: loadError || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;
    return (
      <main className="module-page">
        {header}
        <OfflineBanner feature="Data-source health" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Loading…"}
          description={failure ? failure.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  switch (view.status) {
    case "setup_required":
      return (
        <main className="module-page">
          {header}
          <OfflineBanner feature="Data-source health" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
            {view.steps[0] ? (
              <Button as="a" variant="primary" href={view.steps[0].href}>
                {view.steps[0].label}
              </Button>
            ) : null}
          </EmptyState>
        </main>
      );
    case "live":
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  return (
    <main className="module-page">
      {header}
      <OfflineBanner feature="Data-source health" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <DataSourceHealthNextActions orgId={view.orgId} />
      <div style={{ display: "grid", gap: 16 }}>
        <BannerPanel view={view} busy={busy} mutate={mutate} />
        <SourcesPanel view={view} />
        {view.showBanner ? <FallbacksPanel view={view} /> : null}
        <AcknowledgmentsPanel view={view} />
      </div>
    </main>
  );
}

function BannerPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const { health } = view;
  return (
    <Panel aria-label="Data-source health status">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <span className={`app-badge ${modeTone(health.mode)}`}>{degradedModeReasonLabel(health.mode)}</span>
          <h2 style={{ margin: "6px 0 0" }}>{health.bannerTitle}</h2>
          <small className="app-muted">{health.bannerDetail}</small>
        </div>
        {view.showBanner ? (
          <Button variant="secondary" type="button" disabled={busy || Boolean(view.activeAcknowledgment)} onClick={() => mutate({ action: "acknowledge", source: "tba", mode: health.mode, note: "Acknowledged from Data-source health", }) }>
            {view.activeAcknowledgment ? "Acknowledged" : "Acknowledge"}
          </Button>
        ) : null}
      </header>
      {view.activeAcknowledgment ? (
        <p className="app-muted" style={{ marginTop: 10 }}>
          Acknowledged {acknowledgmentAgeMinutes(view.activeAcknowledgment.acknowledgedAt)} min ago
          {view.activeAcknowledgment.note ? ` — ${view.activeAcknowledgment.note}` : ""}
        </p>
      ) : null}
    </Panel>
  );
}

function SourcesPanel({ view }: { view: LiveView }) {
  const { health } = view;
  if (health.sources.length === 0) {
    return (
      <EmptyState
        badge="No sources tracked"
        badgeTone="setup"
        title="No reference data sources are tracked yet"
        description="Once TBA/Statbotics sync runs, source health appears here."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Sources</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {health.sources.map((source) => (
          <li key={source.source} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{degradedModeSourceLabel(source.source)}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                status: {source.status}
                {source.lastError ? ` · ${source.lastError}` : ""}
              </small>
              <small className="app-muted">
                last success {source.lastSuccessAt ? new Date(source.lastSuccessAt).toLocaleString() : "unknown"}
                {" · "}
                {source.etagResources} cached / {source.erroredResources} errored
              </small>
            </div>
          </li>
        ))}
      </ul>
      <p className="app-muted" style={{ marginTop: 10 }}>
        {health.usingLastGoodCache
          ? "Showing the last saved rankings and schedule."
          : health.cacheHasRows
            ? "Live sync is healthy."
            : "No reference cache rows are available yet."}
      </p>
    </Panel>
  );
}

function FallbacksPanel({ view }: { view: LiveView }) {
  if (view.fallbacks.length === 0) return null;
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Read-only fallbacks while degraded</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.fallbacks.map((fallback) => (
          <li key={fallback.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{fallback.label}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {fallback.detail}
              </small>
            </div>
            <Button as="a" variant="secondary" href={fallback.href}>
              Open
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function AcknowledgmentsPanel({ view }: { view: LiveView }) {
  if (view.recentAcknowledgments.length === 0) {
    return (
      <EmptyState
        badge="No acknowledgments yet"
        badgeTone="setup"
        title="No degraded-mode acknowledgments logged"
        description="When the team acknowledges a degraded or unavailable source, it appears here for the record."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Recent acknowledgments</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.recentAcknowledgments.map((ack) => (
          <li key={ack.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>
                {degradedModeSourceLabel(ack.source)} · {degradedModeReasonLabel(ack.mode)}
              </strong>
              <small className="app-muted" style={{ display: "block" }}>
                {new Date(ack.acknowledgedAt).toLocaleString()}
                {ack.resolvedAt ? " · resolved" : ""}
                {ack.note ? ` · ${ack.note}` : ""}
              </small>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
