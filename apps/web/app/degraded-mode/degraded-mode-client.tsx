"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { acknowledgmentAgeMinutes, degradedModeReasonLabel, degradedModeSourceLabel } from "../../lib/degraded-mode";
import type { DegradedModeView } from "../../lib/degraded-mode/compute-degraded-mode";

type LiveView = Extract<DegradedModeView, { status: "live" }>;

function modeTone(mode: LiveView["health"]["mode"]): string {
  if (mode === "ok") return "good";
  if (mode === "stale") return "setup";
  return "demo";
}

export default function DegradedModeClient() {
  const [view, setView] = useState<DegradedModeView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    setLoadError("");
    setErrorStatus(null);
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/degraded-mode${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as DegradedModeView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          setErrorStatus(response.status);
          setLoadError("error" in data && data.error ? data.error : "");
          return;
        }
        setView(data);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
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
        });
        const data = (await response.json()) as DegradedModeView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  // Retry cannot fix an expired session, so the failure decides its own action.
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
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Data-source health"}
          </>
        }
        title="Data-source degraded mode"
        description="Live TBA / Statbotics / reference-database health, with the read-only fallbacks the rest of the app uses while a source is degraded."
      >
        {orgId ? (
          <Button as="a" variant="secondary" href={`/team/data?orgId=${encodeURIComponent(orgId)}`}>
            Team · Data
          </Button>
        ) : null}
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {failure ? (
        <EmptyState title={failure.title} description={failure.description}>
          {failure.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your team." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <BannerPanel view={view} busy={busy} mutate={mutate} />
          <SourcesPanel view={view} />
          {view.showBanner ? <FallbacksPanel view={view} /> : null}
          <AcknowledgmentsPanel view={view} />
        </div>
      )}
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
          <Button variant="secondary" type="button" disabled={busy || Boolean(view.activeAcknowledgment)} onClick={() => mutate({ action: "acknowledge", source: "tba", mode: health.mode, note: "Acknowledged from Data-source degraded mode", }) }>
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
