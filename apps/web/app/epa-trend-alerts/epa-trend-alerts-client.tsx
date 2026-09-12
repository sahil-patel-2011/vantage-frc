"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
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
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./epa-trend-alerts.css";

function isEpaTrendAlertsView(value: unknown): value is EpaTrendAlertsView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistEpaTrendSnapshot(orgHint: string, data: EpaTrendAlertsView): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("epa-trend", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("epa-trend", "_", data);
  } catch {
    // Live Rating alerts already painted; IndexedDB is best-effort.
  }
}

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
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
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

  return (
    <main className="module-page epa-trend-alerts-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Rating alerts"}
          </>
        }
        title="Rating alerts"
        description={description}
      >
        <EpaRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Needs setup"
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
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {shell === "setup" ? (
          <Button as="a" variant="primary" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>Choose your team</Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href="#epa-trend-alerts-watch">Watch a team</Button>
        ) : null}
      </EmptyState>
      {shell === "ready" ? <EpaNextActionsPanel actions={actions} /> : null}
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
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<EpaTrendAlertsView | null>(null);
  viewRef.current = view;

  const load = useCallback(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<EpaTrendAlertsView>("epa-trend", urlOrg || "_");
        if (!viewRef.current && cached?.data && isEpaTrendAlertsView(cached.data)) {
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
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      try {
        const response = await fetch(
          `/api/epa-trend-alerts${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as EpaTrendAlertsView | { error?: string };
        if (!response.ok || !isEpaTrendAlertsView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Rating alerts. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistEpaTrendSnapshot(urlOrg, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Rating alerts. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
        }
      }
    })();
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
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as EpaTrendAlertsView | { error?: string };
        if (!response.ok || !isEpaTrendAlertsView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        void persistEpaTrendSnapshot(orgId, data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  if (shell === "loading") {
    return (
      <EpaShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Rating alerts" fromCache={fromCache} cachedAt={cachedAt} />
      </EpaShell>
    );
  }

  if (shell === "error") {
    return (
      <EpaShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Rating alerts" fromCache={fromCache} cachedAt={cachedAt} />
      </EpaShell>
    );
  }

  if (shell === "setup") {
    return (
      <EpaShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Rating alerts" fromCache={fromCache} cachedAt={cachedAt} />
      </EpaShell>
    );
  }

  if (view?.status !== "live") {
    return (
      <EpaShell description={shellCopy.description} orgId={orgId} shell="setup">
        <OfflineBanner feature="Rating alerts" fromCache={fromCache} cachedAt={cachedAt} />
      </EpaShell>
    );
  }

  return (
    <main className="module-page epa-trend-alerts-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Rating alerts"}
          </>
        }
        title="Rating alerts"
        description="Watch teams you might face and get flagged when their season rating moves meaningfully between events. Cross-check Strategy and Opponent Watchlist."
      >
        <div className="epa-trend-alerts-header-actions">
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>
      <OfflineBanner feature="Rating alerts" fromCache={fromCache} cachedAt={cachedAt} />

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
          <Button as="a" variant="primary" href="#epa-trend-alerts-watch">
            Watch a team
          </Button>
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
        <Panel className="epa-trend-alerts-tip" aria-label="Rating alerts tip">
          <span className="eyebrow">Grounding path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Keep{" "}
            <a href={strategyHref}>Strategy</a> picks grounded in scouted and reference metrics, and pair
            qualitative notes in <a href={watchlistHref}>Opponent Watchlist</a>.
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
    <section className="epa-trend-alerts-stats" aria-label="Rating alerts counts">
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
        Alerts use stored rating between events for teams you watch.
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
        <Button variant="primary" type="submit" disabled={busy || !teamNumber.trim()}>
          Add to watchlist
        </Button>
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
        title="No meaningful rating swings right now"
        description="Alerts appear here once a watched team's season rating moves enough between two events."
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
                {directionLabel(alert.direction)}: {alert.previousEpa} → {alert.latestEpa} rating (
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
