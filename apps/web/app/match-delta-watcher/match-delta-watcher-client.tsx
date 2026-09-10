"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Badge,
  type BadgeTone,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile, Button } from "../../components/ui";
import { matchDeltaAlertTypeLabel, matchDeltaSeverityLabel } from "../../lib/match-delta-watcher";
import type { MatchDeltaWatcherView } from "../../lib/match-delta-watcher/compute-match-delta-watcher";
import {
  MATCH_DELTA_WATCHER_RELATED_INCLUDE,
  classifyMatchDeltaWatcherShell,
  formatMatchDeltaWatcherMetric,
  formatMatchDeltaWatcherRate,
  matchDeltaWatcherNextActions,
  matchDeltaWatcherRelatedLinks,
  matchDeltaWatcherSetupSteps,
  matchDeltaWatcherShellCopy,
  shouldShowMatchDeltaWatcherSummaryTiles,
  type MatchDeltaWatcherNextAction,
  type MatchDeltaWatcherShellKind,
} from "../../lib/match-delta-watcher/match-delta-watcher-related";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./match-delta-watcher.css";

const severityTone: Record<string, BadgeTone | undefined> = {
  critical: "danger",
  watch: "setup",
  info: "good",
};

type LiveView = Extract<MatchDeltaWatcherView, { status: "live" }>;

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = matchDeltaWatcherRelatedLinks(orgId, {
    include: [...MATCH_DELTA_WATCHER_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related mdw-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: MatchDeltaWatcherNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions mdw-next-actions" aria-label="Next actions">
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

function WatcherShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: MatchDeltaWatcherShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = matchDeltaWatcherNextActions({ orgId, shell });
  const copy = matchDeltaWatcherShellCopy(shell);
  const competitionHref = hubWorkbenchHref("competition", "match-delta-watcher", orgId);
  const steps = shell === "setup" ? matchDeltaWatcherSetupSteps(orgId) : [];

  return (
    <main className="module-page mdw-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Match-Delta Watcher"}
          </>
        }
        title="Match-Delta Watcher"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading match-delta watcher">
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
            <Button as="a" variant="primary" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>Choose your team</Button>
          ) : null}
          {shell === "empty" ? (
            <Button as="a" variant="primary" href={hubHref("/competition", "strategy", orgId)}>Open Strategy</Button>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="mdw-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="mdw-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted mdw-tip">{step.detail}</p>
                </div>
                <Button as="a" variant="secondary" href={step.href}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {steps.length === 0 ? <NextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function MatchDeltaWatcherClient() {
  const [view, setView] = useState<MatchDeltaWatcherView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [eventKey, setEventKey] = useState<string | null>(null);

  const load = useCallback((eventOverride?: string) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const eventQuery = eventOverride ?? params.get("eventKey");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (eventQuery) query.set("eventKey", eventQuery);
    void fetch(`/api/match-delta-watcher${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as MatchDeltaWatcherView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        if (data.status === "live") setEventKey(data.eventKey);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const watchedCount = view?.status === "live" ? view.summary.totalWatchedMatches : 0;
  const unacknowledgedCount = view?.status === "live" ? view.summary.unacknowledgedAlerts : 0;

  const shell = classifyMatchDeltaWatcherShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    watchedCount,
  });
  const shellCopy = matchDeltaWatcherShellCopy(shell);
  const nextActions = matchDeltaWatcherNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    watchedCount,
    unacknowledgedCount,
  });
  const competitionHref = hubWorkbenchHref("competition", "match-delta-watcher", orgId);
  const showTiles = shouldShowMatchDeltaWatcherSummaryTiles(watchedCount);
  const loaded = view?.status === "live";

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/match-delta-watcher", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, eventKey: eventKey ?? undefined, ...payload }),
        });
        const data = (await response.json()) as MatchDeltaWatcherView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        if (data.status === "live") setEventKey(data.eventKey);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, eventKey, busy],
  );

  if (shell === "loading") {
    return <WatcherShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <WatcherShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }

  if (shell === "setup") {
    return (
      <WatcherShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (view?.status !== "live") {
    return <WatcherShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page mdw-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Match-Delta Watcher"}
          </>
        }
        title="Match-Delta Watcher"
        description="Watches official match results as they land and flags when reality diverges from your prediction model or pick-list priorities."
      >
        <div className="mdw-header-actions">
          <RelatedStrip orgId={orgId} />
          {view.events.length > 0 ? (
            <label className="app-muted mdw-filter">
              Event
              <select
                value={eventKey ?? view.eventKey}
                onChange={(event) => {
                  const next = event.target.value;
                  setEventKey(next);
                  load(next);
                }}
              >
                {view.events.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Button variant="secondary" id="match-delta-scan" type="button" disabled={busy} onClick={() => mutate({ action: "scan-event" })}>
            Scan for deltas
          </Button>
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {showTiles ? (
        <Panel className="mdw-panel">
          <div className="mdw-stats">
            <StatTile label="Watched matches" value={formatMatchDeltaWatcherMetric(view.summary.totalWatchedMatches, loaded)} />
            <StatTile
              label="Prediction accuracy"
              value={formatMatchDeltaWatcherRate(view.summary.accuracyRate, loaded, {
                hasWatched: watchedCount > 0,
              })}
            />
            <StatTile label="Total alerts" value={formatMatchDeltaWatcherMetric(view.summary.totalAlerts, loaded)} />
            <StatTile label="Critical alerts" value={formatMatchDeltaWatcherMetric(view.summary.criticalAlerts, loaded)} />
            <StatTile
              label="Unacknowledged"
              value={formatMatchDeltaWatcherMetric(view.summary.unacknowledgedAlerts, loaded)}
            />
          </div>
        </Panel>
      ) : null}

      <ConfigPanel view={view} busy={busy} mutate={mutate} />
      <AlertsPanel view={view} busy={busy} mutate={mutate} />
      <NextActionsPanel actions={nextActions} />
    </main>
  );
}

function ConfigPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const enabled = view.config?.enabled ?? true;
  const threshold = view.config?.upsetThreshold ?? 0.65;
  return (
    <Panel className="mdw-panel">
      <header className="mdw-config-header">
        <div>
          <h2>Watch settings — {view.eventKey}</h2>
          <small className="app-muted">
            {view.config ? "Configured from real scans" : "Not yet configured — using defaults until saved."}
          </small>
        </div>
        <Badge tone={enabled ? "good" : "setup"}>{enabled ? "Enabled" : "Disabled"}</Badge>
      </header>
      <div className="mdw-config-controls">
        <label className="mdw-check">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(event) =>
              mutate({ action: "set-config", enabled: event.target.checked, upsetThreshold: threshold })
            }
          />
          Watch this event
        </label>
        <label className="app-muted mdw-filter">
          Critical confidence threshold
          <input
            type="number"
            min={0.51}
            max={1}
            step={0.01}
            value={threshold}
            disabled={busy}
            onChange={(event) =>
              mutate({ action: "set-config", enabled, upsetThreshold: Number(event.target.value) || 0.65 })
            }
          />
        </label>
      </div>
    </Panel>
  );
}

function AlertsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.alerts.length === 0) {
    return (
      <EmptyState
        soft
        badge="No deltas yet"
        badgeTone="setup"
        title="No divergence detected"
        description="Run a scan once official results are posted for this event."
      />
    );
  }
  return (
    <Panel id="match-delta-alerts" className="mdw-panel">
      <h2>Alerts</h2>
      <ul className="mdw-alert-list">
        {view.alerts.map((alert) => (
          <li key={alert.id} className="mdw-alert-row">
            <div>
              <Badge tone={severityTone[alert.severity] ?? "neutral"}>
                {matchDeltaSeverityLabel(alert.severity)}
              </Badge>{" "}
              <strong>
                {alert.compLevel.toUpperCase()} {alert.matchNumber} · {matchDeltaAlertTypeLabel(alert.alertType)}
              </strong>
              <small className="app-muted mdw-block">{alert.summary}</small>
              {alert.teamsInvolved.length > 0 ? (
                <small className="app-muted">{alert.teamsInvolved.join(", ")}</small>
              ) : null}
            </div>
            {alert.acknowledged ? (
              <span className="app-muted">Acknowledged</span>
            ) : (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => mutate({ action: "acknowledge-alert", alertId: alert.id })}
              >
                Acknowledge
              </button>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
