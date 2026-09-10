"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import type { OpponentWatchlistView } from "../../lib/opponent-watchlist/compute-opponent-watchlist";
import {
  OPPONENT_WATCHLIST_RELATED_INCLUDE,
  classifyOpponentWatchlistShell,
  formatOpponentWatchlistMetric,
  opponentWatchlistNextActions,
  opponentWatchlistRelatedLinks,
  opponentWatchlistShellCopy,
  shouldShowOpponentWatchlistSummaryTiles,
  type OpponentWatchlistNextAction,
  type OpponentWatchlistShellKind,
} from "../../lib/opponent-watchlist/opponent-watchlist-related";
import type { WatchlistAlertType } from "../../lib/opponent-watchlist/types";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./opponent-watchlist.css";

function isOpponentWatchlistView(value: unknown): value is OpponentWatchlistView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistOpponentWatchlistSnapshot(
  orgHint: string,
  data: OpponentWatchlistView,
): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("opponent-watchlist", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("opponent-watchlist", "_", data);
  } catch {
    // Live watchlist already painted; IndexedDB is best-effort.
  }
}

type LiveView = Extract<OpponentWatchlistView, { status: "live" }>;

const ALERT_TONE: Record<WatchlistAlertType, string> = {
  epa_up: "good",
  epa_down: "demo",
  schedule_new: "setup",
  schedule_changed: "setup",
};

function formatTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function WatchlistRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = opponentWatchlistRelatedLinks(orgId, {
    include: [...OPPONENT_WATCHLIST_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related opponent-watchlist-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function WatchlistNextActionsPanel({ actions }: { actions: OpponentWatchlistNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions opponent-watchlist-next-actions"
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

function WatchlistShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: OpponentWatchlistShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = opponentWatchlistNextActions({ orgId, shell });
  const copy = opponentWatchlistShellCopy(shell);
  const competitionHref = hubWorkbenchHref("competition", "opponent-watchlist", orgId);

  return (
    <main className="module-page opponent-watchlist-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Opponent Watchlist"}
          </>
        }
        title="Opponent Watchlist"
        description={description}
      >
        <WatchlistRelatedStrip orgId={orgId} />
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
                ? "Empty watchlist"
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
          <Button as="a" variant="primary" href="#opponent-watchlist-watch">Watch a team</Button>
        ) : null}
      </EmptyState>
      <WatchlistNextActionsPanel actions={actions} />
    </main>
  );
}

export default function OpponentWatchlistClient() {
  const [view, setView] = useState<OpponentWatchlistView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<OpponentWatchlistView | null>(null);
  viewRef.current = view;

  const load = useCallback(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<OpponentWatchlistView>(
          "opponent-watchlist",
          urlOrg || "_",
        );
        if (!viewRef.current && cached?.data && isOpponentWatchlistView(cached.data)) {
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
          `/api/opponent-watchlist${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as OpponentWatchlistView | { error?: string };
        if (!response.ok || !isOpponentWatchlistView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Opponent Watchlist. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistOpponentWatchlistSnapshot(urlOrg, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Opponent Watchlist. Showing the last copy on this device.");
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
  const entryCount = view?.status === "live" ? view.entries.length : 0;
  const alertCount = view?.status === "live" ? view.alerts.length : 0;
  const summary = view?.status === "live" ? view.summary : null;

  const shell = classifyOpponentWatchlistShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    entryCount,
  });
  const shellCopy = opponentWatchlistShellCopy(shell);
  const nextActions = opponentWatchlistNextActions({
    orgId,
    shell,
    entryCount,
    alertCount,
  });
  const relatedLinks = opponentWatchlistRelatedLinks(orgId, {
    include: [...OPPONENT_WATCHLIST_RELATED_INCLUDE],
  });
  const competitionHref = hubWorkbenchHref("competition", "opponent-watchlist", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const epaAlertsHref = hubHref("/competition", "epa-trend-alerts", orgId);
  const scoutingHref = hubHref("/competition", "scouting", orgId);
  const lineupHref = withOrgHref("/scouting/lineup", orgId);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/opponent-watchlist", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as OpponentWatchlistView | { error?: string };
        if (!response.ok || !isOpponentWatchlistView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        void persistOpponentWatchlistSnapshot(orgId, data);
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
      <WatchlistShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Opponent Watchlist" fromCache={fromCache} cachedAt={cachedAt} />
      </WatchlistShell>
    );
  }

  if (shell === "error") {
    return (
      <WatchlistShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Opponent Watchlist" fromCache={fromCache} cachedAt={cachedAt} />
      </WatchlistShell>
    );
  }

  if (shell === "setup") {
    return (
      <WatchlistShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Opponent Watchlist" fromCache={fromCache} cachedAt={cachedAt} />
      </WatchlistShell>
    );
  }

  if (view?.status !== "live") {
    return (
      <WatchlistShell description={shellCopy.description} orgId={orgId} shell="setup">
        <OfflineBanner feature="Opponent Watchlist" fromCache={fromCache} cachedAt={cachedAt} />
      </WatchlistShell>
    );
  }

  return (
    <main className="module-page opponent-watchlist-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Opponent Watchlist"}
          </>
        }
        title="Opponent Watchlist"
        description="Track opponent teams personally and get notified when their reference EPA or next scheduled match changes. Cross-check Strategy, EPA Trend Alerts, and Scouting."
      >
        <div className="opponent-watchlist-header-actions">
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>
      <OfflineBanner feature="Opponent Watchlist" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <WatchlistNextActionsPanel actions={nextActions} />

      {shouldShowOpponentWatchlistSummaryTiles(entryCount) && summary ? (
        <SummaryTiles summary={summary} loaded />
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="Empty watchlist"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <Button as="a" variant="primary" href="#opponent-watchlist-watch">
            Watch a team
          </Button>
        </EmptyState>
      ) : null}

      <div className="opponent-watchlist-layout">
        <AddEntryForm busy={busy} mutate={mutate} />
        {shell === "ready" ? (
          <>
            <AlertsPanel view={view} />
            <WatchedTeams view={view} busy={busy} mutate={mutate} />
            <CoveragePriorityPanel view={view} lineupHref={lineupHref} />
          </>
        ) : null}
        <Panel className="opponent-watchlist-tip" aria-label="Opponent Watchlist tip">
          <span className="eyebrow">Grounding path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Watched teams sort earlier on{" "}
            <a href={lineupHref}>Lineup &amp; Coverage</a>. Keep{" "}
            <a href={strategyHref}>Strategy</a> picks grounded in scouted and reference metrics, pair{" "}
            <a href={epaAlertsHref}>EPA Trend Alerts</a> for event-to-event swings, and confirm field
            notes in <a href={scoutingHref}>Scouting</a>
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
    { label: "Watched teams", value: formatOpponentWatchlistMetric(summary.totalWatched, loaded) },
    { label: "EPA alerts", value: formatOpponentWatchlistMetric(summary.epaAlerts, loaded) },
    { label: "Schedule alerts", value: formatOpponentWatchlistMetric(summary.scheduleAlerts, loaded) },
    { label: "Upcoming matches", value: formatOpponentWatchlistMetric(summary.upcomingMatches, loaded) },
  ];
  return (
    <section className="opponent-watchlist-stats" aria-label="Opponent Watchlist counts">
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

function AlertsPanel({ view }: { view: LiveView }) {
  if (view.alerts.length === 0) {
    return (
      <EmptyState
        soft
        badge="No changes"
        badgeTone="good"
        title="No EPA or schedule changes yet"
        description="Alerts appear here once a watched team's reference EPA moves or their next match is scheduled or rescheduled."
      />
    );
  }
  return (
    <Panel id="opponent-watchlist-alerts" className="opponent-watchlist-panel">
      <h2 style={{ marginTop: 0 }}>Alerts</h2>
      <ul className="opponent-watchlist-list">
        {view.alerts.map((alert, index) => (
          <li key={`${alert.entryId}-${alert.type}-${index}`} className="opponent-watchlist-card">
            <div>
              <span className={`app-badge ${ALERT_TONE[alert.type]}`}>{alert.type.replace("_", " ")}</span>
              <span style={{ marginLeft: 8 }}>{alert.message}</span>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function WatchedTeams({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.entries.length === 0) {
    return null;
  }
  return (
    <Panel id="opponent-watchlist-list" className="opponent-watchlist-panel">
      <h2 style={{ marginTop: 0 }}>Watched teams</h2>
      <ul className="opponent-watchlist-list">
        {view.entries.map((entry) => (
          <li key={entry.id} className="opponent-watchlist-card">
            <div>
              <strong>
                #{entry.teamNumber ?? "?"} {entry.nickname ?? entry.teamKey}
              </strong>
              <small className="app-muted" style={{ display: "block" }}>
                {entry.current
                  ? `EPA ${entry.current.epaTotal != null ? entry.current.epaTotal.toFixed(1) : "—"} · rank ${entry.current.rank ?? "—"} at ${entry.current.eventKey}`
                  : "No reference EPA data yet"}
              </small>
              <small className="app-muted" style={{ display: "block" }}>
                {entry.nextMatch
                  ? `Next: ${entry.nextMatch.compLevel.toUpperCase()} ${entry.nextMatch.matchNumber} · ${formatTime(entry.nextMatch.scheduledTime)}`
                  : "No upcoming match scheduled"}
              </small>
              {entry.note ? (
                <small className="app-muted" style={{ display: "block" }}>
                  {entry.note}
                </small>
              ) : null}
              {view.coveragePriorityTeamKeys.indexOf(entry.teamKey) >= 0 ? (
                <small className="app-muted" style={{ display: "block" }}>
                  Coverage priority {view.coveragePriorityTeamKeys.indexOf(entry.teamKey) + 1}
                </small>
              ) : null}
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => mutate({ action: "remove-entry", entryId: entry.id })}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function CoveragePriorityPanel({ view, lineupHref }: { view: LiveView; lineupHref: string }) {
  if (view.coveragePriorityTeamKeys.length === 0) return null;
  const byKey = new Map(view.entries.map((entry) => [entry.teamKey, entry]));
  return (
    <Panel id="opponent-watchlist-coverage" className="opponent-watchlist-panel">
      <h2 style={{ marginTop: 0 }}>Coverage order</h2>
      <p className="app-muted" style={{ marginTop: 0 }}>
        Real watchlist rows move these teams earlier in the scouting coverage queue.
      </p>
      <ol className="opponent-watchlist-list">
        {view.coveragePriorityTeamKeys.map((teamKey, index) => {
          const entry = byKey.get(teamKey);
          return (
            <li key={teamKey} className="opponent-watchlist-card">
              <strong>
                {index + 1}. #{entry?.teamNumber ?? teamKey.replace(/^frc/i, "")}{" "}
                {entry?.nickname ?? teamKey}
              </strong>
            </li>
          );
        })}
      </ol>
      <Button as="a" variant="secondary" href={lineupHref}>
        Open lineup coverage
      </Button>
    </Panel>
  );
}

function AddEntryForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [teamKey, setTeamKey] = useState("");
  const [note, setNote] = useState("");

  return (
    <Panel
      id="opponent-watchlist-watch"
      as="form"
      className="opponent-watchlist-panel"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = teamKey.trim().toLowerCase();
        if (!/^frc\d+$/.test(trimmed)) return;
        mutate({ action: "add-entry", teamKey: trimmed, note: note || undefined });
        setTeamKey("");
        setNote("");
      }}
    >
      <h2 style={{ margin: 0 }}>Watch a team</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Alerts use reference EPA and scheduled matches for the teams you watch.
      </p>
      <FormGrid min={160}>
        <FormRow label="Team key" hint="e.g. frc254">
          <input value={teamKey} onChange={(event) => setTeamKey(event.target.value)} placeholder="frc254" required />
        </FormRow>
        <FormRow label="Note (optional)">
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Alliance-selection watch" />
        </FormRow>
      </FormGrid>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !/^frc\d+$/.test(teamKey.trim().toLowerCase())}>
          Add to watchlist
        </Button>
      </div>
    </Panel>
  );
}
