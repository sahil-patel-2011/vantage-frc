"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { directionLabel, severityLabel } from "../../lib/epa-trend-alerts";
import type { EpaTrendAlertsView } from "../../lib/epa-trend-alerts/compute-epa-trend-alerts";
import {
  EPA_TREND_ALERTS_RELATED_INCLUDE,
  classifyEpaTrendAlertsShell,
  epaTrendAlertsNextActions,
  epaTrendAlertsRelatedLinks,
  epaTrendAlertsShellCopy,
  formatEpaTrendMetric,
  shouldShowEpaTrendSummaryTiles,
  type EpaTrendAlertsNextAction,
  type EpaTrendAlertsShellKind,
} from "../../lib/epa-trend-alerts/epa-trend-alerts-related";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./epa-trend-alerts.css";

type LiveView = Extract<EpaTrendAlertsView, { status: "live" }>;

function severityTone(severity: string): string {
  return severity === "high" ? "demo" : "setup";
}

function pct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${Math.round(value * 1000) / 10}%`;
}

function EpaRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = epaTrendAlertsRelatedLinks(orgId, {
    include: [...EPA_TREND_ALERTS_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related epa-trend-alerts-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function EpaNextActionsPanel({ actions }: { actions: EpaTrendAlertsNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions epa-trend-alerts-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Strategy and Opponent Watchlist — never DEMO EPA forecasts.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href} aria-label={`Open ${action.label}`}>Open</a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function EpaShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: EpaTrendAlertsShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = epaTrendAlertsNextActions({ orgId, shell });
  const copy = epaTrendAlertsShellCopy(shell);
  const competitionHref = hubWorkbenchHref("competition", "epa-trend-alerts", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const watchlistHref = hubHref("/competition", "opponent-watchlist", orgId);

  return (
    <main className="module-page epa-trend-alerts-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / EPA Trend Alerts"}
          </>
        }
        title="EPA Trend Alerts"
        description={description}
      >
        <EpaRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No teams watched"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
            Open Workspace
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href="#epa-trend-alerts-watch">
              Watch a team
            </a>
            <a className="app-button secondary" href={strategyHref}>
              Open Strategy
            </a>
            <a className="app-button secondary" href={watchlistHref}>
              Open Opponent Watchlist
            </a>
          </>
        ) : null}
      </EmptyState>
      <EpaNextActionsPanel actions={actions} />
    </main>
  );
}

export default function EpaTrendAlertsClient() {
  const [view, setView] = useState<EpaTrendAlertsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [teamNumber, setTeamNumber] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/epa-trend-alerts${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as EpaTrendAlertsView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const watchlistCount = view?.status === "live" ? view.watchlist.length : 0;
  const alertCount = view?.status === "live" ? view.alerts.length : 0;
  const summary = view?.status === "live" ? view.summary : null;

  const shell = classifyEpaTrendAlertsShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    watchlistCount,
  });
  const shellCopy = epaTrendAlertsShellCopy(shell);
  const nextActions = epaTrendAlertsNextActions({
    orgId,
    shell,
    watchlistCount,
    alertCount,
  });
  const relatedLinks = epaTrendAlertsRelatedLinks(orgId, {
    include: [...EPA_TREND_ALERTS_RELATED_INCLUDE],
  });
  const competitionHref = hubWorkbenchHref("competition", "epa-trend-alerts", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const watchlistHref = hubHref("/competition", "opponent-watchlist", orgId);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/epa-trend-alerts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as EpaTrendAlertsView | { error?: string };
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

  if (shell === "loading") {
    return <EpaShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <EpaShell
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
      <EpaShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (view?.status !== "live") {
    return <EpaShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page epa-trend-alerts-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / EPA Trend Alerts"}
          </>
        }
        title="EPA Trend Alerts"
        description="Watch teams you might face and get flagged when their reference EPA moves meaningfully between events — never DEMO EPA forecasts. Cross-check Strategy and Opponent Watchlist."
      >
        <div className="epa-trend-alerts-header-actions">
          {relatedLinks.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <EpaNextActionsPanel actions={nextActions} />

      {shouldShowEpaTrendSummaryTiles(watchlistCount) && summary ? (
        <SummaryTiles summary={summary} loaded />
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No teams watched"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <a className="app-button" href="#epa-trend-alerts-watch">
            Watch a team
          </a>
          <a className="app-button secondary" href={strategyHref}>
            Open Strategy
          </a>
          <a className="app-button secondary" href={watchlistHref}>
            Open Opponent Watchlist
          </a>
        </EmptyState>
      ) : null}

      <div className="epa-trend-alerts-layout">
        <WatchTeamForm
          busy={busy}
          teamNumber={teamNumber}
          setTeamNumber={setTeamNumber}
          note={note}
          setNote={setNote}
          mutate={mutate}
        />
        {shell === "ready" ? (
          <>
            <AlertsPanel view={view} busy={busy} mutate={mutate} />
            <WatchlistPanel view={view} busy={busy} mutate={mutate} />
          </>
        ) : null}
        <Panel className="epa-trend-alerts-tip" aria-label="EPA Trend Alerts tip">
          <span className="eyebrow">Grounding path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Keep{" "}
            <a href={strategyHref}>Strategy</a> picks grounded in scouted and reference metrics, and pair
            qualitative notes in <a href={watchlistHref}>Opponent Watchlist</a> — never invent DEMO EPA
            forecasts.
          </p>
        </Panel>
      </div>
    </main>
  );
}

function SummaryTiles({
  summary,
  loaded,
}: {
  summary: LiveView["summary"];
  loaded: boolean;
}) {
  const tiles = [
    { label: "Watched teams", value: formatEpaTrendMetric(summary.watchlistCount, loaded) },
    { label: "Active alerts", value: formatEpaTrendMetric(summary.alertCount, loaded) },
    { label: "Rising", value: formatEpaTrendMetric(summary.risingCount, loaded) },
    { label: "Falling", value: formatEpaTrendMetric(summary.fallingCount, loaded) },
    { label: "High severity", value: formatEpaTrendMetric(summary.highSeverityCount, loaded) },
  ];
  return (
    <section className="epa-trend-alerts-stats" aria-label="EPA Trend Alerts counts">
      {tiles.map((tile) => (
        <div key={tile.label}>
          <strong>{tile.value}</strong>
          <span className="app-muted" style={{ display: "block" }}>
            {tile.label}
          </span>
        </div>
      ))}
    </section>
  );
}

function WatchTeamForm({
  busy,
  teamNumber,
  setTeamNumber,
  note,
  setNote,
  mutate,
}: {
  busy: boolean;
  teamNumber: string;
  setTeamNumber: (value: string) => void;
  note: string;
  setNote: (value: string) => void;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel
      id="epa-trend-alerts-watch"
      as="form"
      className="epa-trend-alerts-panel"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = Number(teamNumber);
        if (!Number.isFinite(parsed) || parsed <= 0) return;
        mutate({ action: "watch-team", teamNumber: parsed, note: note || undefined });
        setTeamNumber("");
        setNote("");
      }}
    >
      <h2 style={{ margin: 0 }}>Add a team to the watchlist</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Alerts use only Neon reference EPA between events for teams you watch — never DEMO EPA forecasts.
      </p>
      <FormGrid min={160}>
        <FormRow label="Team number">
          <input
            type="number"
            min={1}
            value={teamNumber}
            onChange={(event) => setTeamNumber(event.target.value)}
            placeholder="254"
            required
          />
        </FormRow>
        <FormRow label="Note (optional)">
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Likely alliance pick" />
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !teamNumber.trim()}>
          Add to watchlist
        </button>
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
        badge="No alerts"
        badgeTone="good"
        title="No meaningful EPA swings right now"
        description="Alerts appear here once a watched team's reference EPA moves enough between two events — never DEMO forecasts."
      />
    );
  }
  return (
    <Panel id="epa-trend-alerts-list" className="epa-trend-alerts-panel">
      <h2 style={{ marginTop: 0 }}>Trend alerts</h2>
      <ul className="epa-trend-alerts-list">
        {view.alerts.map((alert) => (
          <li key={alert.fingerprint} className="epa-trend-alerts-card">
            <div>
              <span className={`app-badge ${severityTone(alert.severity)}`}>{severityLabel(alert.severity)}</span>{" "}
              <strong>
                {alert.teamNumber ?? alert.teamKey}
                {alert.nickname ? ` — ${alert.nickname}` : ""}
              </strong>
              <small className="app-muted" style={{ display: "block" }}>
                {directionLabel(alert.direction)}: {alert.previousEpa} → {alert.latestEpa} EPA (
                {pct(alert.percentChange)}) between {alert.previousEventName ?? alert.previousEventKey} and{" "}
                {alert.latestEventName ?? alert.latestEventKey}
              </small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() =>
                mutate({ action: "dismiss-alert", teamKey: alert.teamKey, latestEventKey: alert.latestEventKey })
              }
            >
              Dismiss
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function WatchlistPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.watchlist.length === 0) {
    return null;
  }
  return (
    <Panel className="epa-trend-alerts-panel">
      <h2 style={{ marginTop: 0 }}>Watchlist</h2>
      <ul className="epa-trend-alerts-list">
        {view.watchlist.map((team) => (
          <li key={team.id} className="epa-trend-alerts-card">
            <div>
              <strong>
                {team.teamNumber ?? team.teamKey}
                {team.nickname ? ` — ${team.nickname}` : ""}
              </strong>
              {team.note ? (
                <small className="app-muted" style={{ display: "block" }}>
                  {team.note}
                </small>
              ) : null}
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => mutate({ action: "unwatch-team", watchlistId: team.id })}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
