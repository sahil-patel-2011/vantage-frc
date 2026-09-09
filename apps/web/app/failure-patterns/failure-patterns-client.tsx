"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Badge,
  type BadgeTone,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import { failurePatternNoteStatusLabel, failurePatternTierLabel } from "../../lib/failure-patterns";
import {
  FAILURE_PATTERN_NOTE_STATUSES,
  type FailurePatternsView,
} from "../../lib/failure-patterns/compute-failure-patterns";
import type { FailurePatternCluster, FailurePatternNoteStatus, FailurePatternTier } from "../../lib/failure-patterns/types";
import {
  FAILURE_PATTERNS_RELATED_INCLUDE,
  classifyFailurePatternsShell,
  formatFailurePatternsMetric,
  failurePatternsNextActions,
  failurePatternsRelatedLinks,
  failurePatternsSetupSteps,
  failurePatternsShellCopy,
  shouldShowFailurePatternsSummaryTiles,
  type FailurePatternsNextAction,
  type FailurePatternsShellKind,
} from "../../lib/failure-patterns/failure-patterns-related";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./failure-patterns.css";

const tierBadgeTone: Record<FailurePatternTier, BadgeTone> = {
  critical: "danger",
  watch: "setup",
  minor: "good",
};

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = failurePatternsRelatedLinks(orgId, {
    include: [...FAILURE_PATTERNS_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related fp-related" aria-label="Related build tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: FailurePatternsNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions fp-next-actions" aria-label="Next actions">
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
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PatternsShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: FailurePatternsShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = failurePatternsNextActions({ orgId, shell });
  const copy = failurePatternsShellCopy(shell);
  const buildHref = hubWorkbenchHref("build", "failure-patterns", orgId);
  const steps = shell === "setup" ? failurePatternsSetupSteps(orgId) : [];

  return (
    <main className="module-page fp-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Repeat Failure Patterns"}
          </>
        }
        title="Repeat Failure Patterns"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading failure patterns">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Setup required" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {shell === "setup" ? (
            <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
              Open Workspace
            </a>
          ) : null}
          {shell === "empty" ? (
            <>
              <a className="app-button" href={hubHref("/build", "fmea", orgId)}>
                Open FMEA
              </a>
              <a className="app-button secondary" href={hubHref("/competition", "pit-repair-triage", orgId)}>
                Open Pit Triage
              </a>
            </>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="fp-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="fp-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted fp-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {steps.length === 0 ? <NextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function FailurePatternsClient() {
  const [view, setView] = useState<FailurePatternsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/failure-patterns${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as FailurePatternsView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const clusterCount = view?.status === "live" ? view.clusters.length : 0;
  const eventCount = view?.status === "live" ? view.summary.totalEvents : 0;
  const criticalCount = view?.status === "live" ? view.summary.criticalClusters : 0;

  const shell = classifyFailurePatternsShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    clusterCount,
  });
  const shellCopy = failurePatternsShellCopy(shell);
  const nextActions = failurePatternsNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    clusterCount,
    criticalCount,
  });
  const buildHref = hubWorkbenchHref("build", "failure-patterns", orgId);
  const showTiles = shouldShowFailurePatternsSummaryTiles(eventCount, clusterCount);
  const loaded = view?.status === "live";

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/failure-patterns", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as FailurePatternsView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  if (shell === "loading") {
    return <PatternsShell description={shellCopy.description} orgId={null} shell="loading" />;
  }
  if (shell === "error") {
    return (
      <PatternsShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }
  if (shell === "setup" || view?.status !== "live") {
    return (
      <PatternsShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  return (
    <main className="module-page fp-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Repeat Failure Patterns"}
          </>
        }
        title="Repeat Failure Patterns"
        description="Clusters FMEA and equipment incidents by subsystem. Cross-check FMEA and Spare Kit."
      >
        <div className="fp-header-actions">
          <RelatedStrip orgId={orgId} />
          {view.seasons.length > 0 ? (
            <label className="app-muted fp-filter">
              Season
              <select
                value={season ?? view.seasonYear}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setSeason(next);
                  load(next);
                }}
              >
                {view.seasons.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {showTiles ? (
        <Panel className="fp-panel">
          <div className="fp-stats">
            <StatTile label="Total events" value={formatFailurePatternsMetric(view.summary.totalEvents, loaded)} />
            <StatTile
              label="Subsystems affected"
              value={formatFailurePatternsMetric(view.summary.totalClusters, loaded)}
            />
            <StatTile
              label="Repeat patterns"
              value={formatFailurePatternsMetric(view.summary.repeatClusters, loaded)}
            />
            <StatTile label="Critical" value={formatFailurePatternsMetric(view.summary.criticalClusters, loaded)} />
          </div>
        </Panel>
      ) : null}

      {view.clusters.length === 0 ? (
        <EmptyState
          soft
          badge="No failures logged"
          badgeTone="setup"
          title="No FMEA or incident records yet this season"
          description="Log failures in FMEA or equipment incidents."
        >
          <a className="app-button" href={hubHref("/build", "fmea", orgId)}>
            Open FMEA
          </a>
          <a className="app-button secondary" href={hubHref("/competition", "pit-repair-triage", orgId)}>
            Open Pit Triage
          </a>
        </EmptyState>
      ) : (
        <div id="failure-patterns-clusters" className="fp-clusters">
          {view.clusters.map((cluster) => (
            <ClusterCard key={cluster.subsystemName} cluster={cluster} busy={busy} mutate={mutate} />
          ))}
        </div>
      )}
      <NextActionsPanel actions={nextActions} />
    </main>
  );
}

function ClusterCard({
  cluster,
  busy,
  mutate,
}: {
  cluster: FailurePatternCluster;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<FailurePatternNoteStatus>("acknowledged");

  return (
    <Panel className="fp-panel">
      <header className="fp-cluster-header">
        <div>
          <Badge tone={tierBadgeTone[cluster.tier]}>{failurePatternTierLabel(cluster.tier)}</Badge>
          <h2>{cluster.subsystemName}</h2>
          <small className="app-muted">
            {cluster.totalCount} failure(s) · {cluster.fmeaCount} FMEA · {cluster.incidentCount} incident(s) ·{" "}
            {cluster.firstOccurredOn} → {cluster.lastOccurredOn}
          </small>
        </div>
        <div className="fp-cluster-count">
          <strong>{cluster.totalCount}×</strong>
          {cluster.maxSeverity != null ? (
            <small className="app-muted fp-block">max severity {cluster.maxSeverity}/10</small>
          ) : null}
        </div>
      </header>

      <ul className="fp-event-list">
        {cluster.events.map((event) => (
          <li key={event.id} className="fp-event-row">
            <span>
              {event.title} <small className="app-muted">({event.source === "fmea" ? "FMEA" : "Incident"})</small>
            </span>
            <small className="app-muted">
              {event.occurredOn}
              {event.severity != null ? ` · sev ${event.severity}` : ""}
            </small>
          </li>
        ))}
      </ul>

      {cluster.latestNote ? (
        <p className="app-muted">
          <strong>{failurePatternNoteStatusLabel(cluster.latestNote.status)}</strong>
          {cluster.latestNote.note ? `: ${cluster.latestNote.note}` : ""}
        </p>
      ) : null}

      <FormGrid min={160}>
        <FormRow label="Status">
          <select value={status} onChange={(event) => setStatus(event.target.value as FailurePatternNoteStatus)}>
            {FAILURE_PATTERN_NOTE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {failurePatternNoteStatusLabel(s)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Note (optional)">
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Corrective action taken" />
        </FormRow>
      </FormGrid>
      <div>
        <button
          type="button"
          className="app-button secondary"
          disabled={busy}
          onClick={() => {
            mutate({
              action: "log-note",
              subsystemName: cluster.subsystemName,
              status,
              note: note || undefined,
            });
            setNote("");
          }}
        >
          Log update
        </button>
      </div>
    </Panel>
  );
}
