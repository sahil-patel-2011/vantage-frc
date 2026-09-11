"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { scoutAccuracyTierLabel } from "../../lib/scout-accuracy";
import type { ScoutAccuracyView } from "../../lib/scout-accuracy/compute-scout-accuracy";
import type { ScoutAccuracyScoutStat, ScoutAccuracyTier } from "../../lib/scout-accuracy/types";
import {
  SCOUT_ACCURACY_RELATED_INCLUDE,
  classifyScoutAccuracyShell,
  formatScoutAccuracyMetric,
  formatScoutAccuracyRate,
  formatScoutAccuracyScore,
  scoutAccuracyNextActions,
  scoutAccuracyRelatedLinks,
  scoutAccuracySetupSteps,
  scoutAccuracyShellCopy,
  shouldShowScoutAccuracySummaryTiles,
  type ScoutAccuracyNextAction,
  type ScoutAccuracyShellKind,
} from "../../lib/scout-accuracy/scout-accuracy-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./scout-accuracy.css";

function tierTone(tier: ScoutAccuracyTier): "good" | "setup" | "" {
  if (tier === "lead") return "good";
  if (tier === "core") return "setup";
  return "";
}

type LiveView = Extract<ScoutAccuracyView, { status: "live" }>;

function isScoutAccuracyView(value: unknown): value is ScoutAccuracyView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function scoutAccuracyCacheOrg(data: ScoutAccuracyView, orgHint: string): string {
  if ("orgId" in data && typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistScoutAccuracySnapshot(
  orgHint: string,
  eventHint: string,
  data: ScoutAccuracyView,
): Promise<void> {
  const cacheOrg = scoutAccuracyCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const eventKey = data.status === "live" && data.eventKey ? data.eventKey : "";
  try {
    await putFeatureSnapshot("scout-accuracy", cacheOrg, data, eventHint || eventKey);
    if (!orgHint) await putFeatureSnapshot("scout-accuracy", "_", data, eventHint || eventKey);
  } catch {
    // Live Scout Accuracy already painted; IndexedDB is best-effort.
  }
}

function ScoutAccuracyRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = scoutAccuracyRelatedLinks(orgId, {
    include: [...SCOUT_ACCURACY_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related scout-accuracy-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function ScoutAccuracyNextActionsPanel({ actions }: { actions: ScoutAccuracyNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions scout-accuracy-next-actions"
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

function ScoutAccuracyShell({
  description,
  orgId,
  shell,
  error,
  errorStatus,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: ScoutAccuracyShellKind;
  error?: string;
  /** HTTP status of the failed load, so an expired session can offer sign-in. */
  errorStatus?: number | null;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = scoutAccuracyNextActions({ orgId, shell });
  const copy = scoutAccuracyShellCopy(shell);
  const competitionHref = hubHref("/competition", "scouting", orgId);
  const setup = shell === "setup" ? scoutAccuracySetupSteps(orgId)[0] : null;
  const failure =
    shell === "error"
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus ?? null,
            message: error ?? null,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error ?? null,
          },
        )
      : null;
  const scoutingHref = hubHref("/competition", "scouting", orgId);

  return (
    <main className="module-page scout-accuracy-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Scout Accuracy"}
          </>
        }
        title="Scout Accuracy"
        description={description}
      >
        <ScoutAccuracyRelatedStrip orgId={orgId} />
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
                ? "No scores yet"
                : copy.badge
        }
        badgeTone="setup"
        title={failure ? failure.title : copy.title}
        description={failure ? failure.description : (error ?? copy.description)}
        aria-busy={shell === "loading"}
      >
        {failure?.primary ? (
          <Button as="a" variant="primary" href={failure.primary.href}>
            {failure.primary.label}
          </Button>
        ) : null}
        {failure?.showRetry && onRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {setup ? (
          <Button as="a" variant="primary" href={setup.href}>
            {setup.label}
          </Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href={scoutingHref}>Log scout entries</Button>
        ) : null}
      </EmptyState>
      {shell === "ready" ? <ScoutAccuracyNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function ScoutAccuracyClient({ orgId: initialOrgId }: { orgId?: string }) {
  const [view, setView] = useState<ScoutAccuracyView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<ScoutAccuracyView | null>(null);
  viewRef.current = view;

  const orgId = (view && "orgId" in view ? view.orgId : null) ?? initialOrgId ?? null;

  const load = useCallback((eventOverride?: string) => {
    void (async () => {
      const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      const urlOrg = (initialOrgId ?? params.get("orgId"))?.trim() ?? "";
      const eventHint = (eventOverride ?? params.get("eventKey") ?? "").trim();
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<ScoutAccuracyView>(
          "scout-accuracy",
          urlOrg || "_",
          eventHint,
        );
        if (!viewRef.current && cached?.data && isScoutAccuracyView(cached.data)) {
          setView(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      setFailureStatus(null);
      setError("");
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      if (eventHint) query.set("eventKey", eventHint);
      try {
        const response = await fetch(
          `/api/scout-accuracy${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as ScoutAccuracyView | { error?: string };
        if (response.status === 401 || response.status === 403) {
          setView(null);
          setFromCache(false);
          setCachedAt(null);
          setFetchFailed(true);
          setFailureStatus(response.status);
          setError("error" in data && data.error ? data.error : "Could not load scout accuracy.");
          return;
        }
        if (!response.ok || !isScoutAccuracyView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Scout Accuracy. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
            setFailureStatus(response.status);
            setError("error" in data && data.error ? data.error : "Could not load scout accuracy.");
          }
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistScoutAccuracySnapshot(urlOrg, eventHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Scout Accuracy. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
          setError("Network error — please try again.");
        }
      }
    })();
  }, [initialOrgId]);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/scout-accuracy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as ScoutAccuracyView | { error?: string };
        if (!response.ok || !isScoutAccuracyView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        void persistScoutAccuracySnapshot(orgId, data.status === "live" && data.eventKey ? data.eventKey : "", data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  const totalEntries = view?.status === "live" ? view.summary.totalEntries : 0;
  const suggestedPromotions = view?.status === "live" ? view.summary.suggestedPromotions : 0;
  const eventKey = view?.status === "live" ? view.eventKey : null;

  const shell = classifyScoutAccuracyShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    eventKey,
    totalEntries,
  });
  const shellCopy = scoutAccuracyShellCopy(shell);
  const nextActions = scoutAccuracyNextActions({
    orgId,
    shell,
    totalEntries,
    suggestedPromotions,
  });
  const competitionHref = hubHref("/competition", "scouting", orgId);
  const showTiles =
    view?.status === "live" &&
    shouldShowScoutAccuracySummaryTiles({
      totalEntries: view.summary.totalEntries,
      totalScouts: view.summary.totalScouts,
    });
  const loaded = view?.status === "live";

  if (shell === "loading") {
    return (
      <ScoutAccuracyShell description={shellCopy.description} orgId={orgId} shell="loading">
        <OfflineBanner feature="Scout Accuracy" fromCache={fromCache} cachedAt={cachedAt} />
      </ScoutAccuracyShell>
    );
  }

  if (shell === "error") {
    return (
      <ScoutAccuracyShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        errorStatus={failureStatus}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Scout Accuracy" fromCache={fromCache} cachedAt={cachedAt} />
      </ScoutAccuracyShell>
    );
  }

  if (shell === "setup") {
    return (
      <ScoutAccuracyShell
        description={
          view?.status === "setup_required" ? view.message : shellCopy.description
        }
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Scout Accuracy" fromCache={fromCache} cachedAt={cachedAt} />
      </ScoutAccuracyShell>
    );
  }

  if (shell === "empty" || view?.status !== "live") {
    return (
      <ScoutAccuracyShell description={shellCopy.description} orgId={orgId} shell="empty">
        <OfflineBanner feature="Scout Accuracy" fromCache={fromCache} cachedAt={cachedAt} />
      </ScoutAccuracyShell>
    );
  }

  return (
    <main className="module-page scout-accuracy-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Scout Accuracy"}
          </>
        }
        title="Scout Accuracy"
        description="Post-event, each scout's reported totals are scored against cached TBA results — ranking the roster for pick-desk rotation."
      >
        <div className="scout-accuracy-header-meta">
          <ScoutAccuracyRelatedStrip orgId={orgId} />
          {view.eventKey ? (
            <Button variant="secondary" type="button" disabled={busy} onClick={() => void mutate({ action: "record-snapshot", eventKey: view.eventKey })}>
              Record snapshot
            </Button>
          ) : null}
        </div>
      </PageHeader>

      <OfflineBanner feature="Scout Accuracy" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="form-message" role="status">
          {error}
        </p>
      ) : null}

      {view.events.length > 0 ? (
        <section className="scout-accuracy-event" aria-label="Event filter">
          <label>
            Event
            <select
              value={view.eventKey ?? ""}
              onChange={(event) => load(event.target.value)}
            >
              {view.events.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          <span className="app-muted">{view.eventKey}</span>
        </section>
      ) : null}

      {showTiles ? <SummaryTiles view={view} loaded={loaded} /> : null}
      <Leaderboard view={view} busy={busy} mutate={mutate} loaded={loaded} />
      <ScoutAccuracyNextActionsPanel actions={nextActions} />
      <p className="app-muted scout-accuracy-footer-links">
        Also see{" "}
        <a href={hubHref("/competition", "scouting", orgId)}>Scouting</a>
        {" · "}
        <a href={withOrgHref("/scouting/lineup", orgId)}>Coverage</a>
        {" · "}
        <a href={hubHref("/competition", "strategy", orgId)}>Strategy</a>
      </p>
    </main>
  );
}

function SummaryTiles({ view, loaded }: { view: LiveView; loaded: boolean }) {
  const { summary, lastSnapshot } = view;
  const hasVerifiable = summary.verifiableEntries > 0;
  return (
    <section className="scout-accuracy-kpis" aria-label="Accuracy summary">
      <article>
        <span>Entries scored</span>
        <strong>{formatScoutAccuracyMetric(summary.totalEntries, loaded)}</strong>
        <small>match scout rows</small>
      </article>
      <article>
        <span>Verifiable</span>
        <strong>{formatScoutAccuracyMetric(summary.verifiableEntries, loaded)}</strong>
        <small>vs TBA totals</small>
      </article>
      <article>
        <span>Scouts ranked</span>
        <strong>{formatScoutAccuracyMetric(summary.totalScouts, loaded)}</strong>
        <small>signed-in scouts</small>
      </article>
      <article>
        <span>Avg accuracy</span>
        <strong>
          {formatScoutAccuracyScore(summary.avgAccuracyScore, loaded, { hasVerifiable })}
        </strong>
        <small>0–100 scale</small>
      </article>
      <article>
        <span>Suggested promotions</span>
        <strong>{formatScoutAccuracyMetric(summary.suggestedPromotions, loaded)}</strong>
        <small>ready for pick desk</small>
      </article>
      {lastSnapshot ? (
        <p className="app-muted" style={{ gridColumn: "1 / -1", margin: 0 }}>
          Last recorded snapshot: {new Date(lastSnapshot.computedAt).toLocaleString()} ·{" "}
          {lastSnapshot.scoutsScored} scout(s), avg score{" "}
          {formatScoutAccuracyScore(lastSnapshot.avgAccuracyScore, true, {
            hasVerifiable: lastSnapshot.scoutsScored > 0,
          })}
        </p>
      ) : (
        <p className="app-muted" style={{ gridColumn: "1 / -1", margin: 0 }}>
          No snapshot recorded yet for this event — scores below are computed live from real
          TBA-verified rows.
        </p>
      )}
    </section>
  );
}

function Leaderboard({
  view,
  busy,
  mutate,
  loaded,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  loaded: boolean;
}) {
  if (view.stats.length === 0) {
    return (
      <EmptyState
        soft
        badge="No verifiable entries yet"
        badgeTone="setup"
        title="No scout accuracy data yet"
        description="Scouted totals will be scored once matches have cached official TBA results."
      >
        <Button as="a" variant="primary" href={hubHref("/competition", "scouting", view.orgId)}>
          Open Scouting
        </Button>
      </EmptyState>
    );
  }
  return (
    <Panel className="scout-accuracy-panel" id="accuracy-leaderboard">
      <header>
        <h2>Leaderboard &amp; pick-desk rotation</h2>
        <p className="app-muted">
          Quality before volume — ranks use TBA-verified totals only.
        </p>
      </header>
      <ul className="scout-accuracy-list">
        {view.stats.map((stat) => (
          <LeaderboardRow
            key={stat.scoutUserId}
            stat={stat}
            busy={busy}
            eventKey={view.eventKey}
            mutate={mutate}
            loaded={loaded}
          />
        ))}
      </ul>
    </Panel>
  );
}

function LeaderboardRow({
  stat,
  busy,
  eventKey,
  mutate,
  loaded,
}: {
  stat: ScoutAccuracyScoutStat;
  busy: boolean;
  eventKey: string | null;
  mutate: (payload: Record<string, unknown>) => void;
  loaded: boolean;
}) {
  const hasVerifiable = stat.verifiableEntries > 0;
  return (
    <li>
      <div>
        <strong>
          <span className="scout-accuracy-rank">{stat.rank}</span>
          {stat.scoutName}
        </strong>
        <span className={`app-badge ${tierTone(stat.tier)}`.trim()} style={{ marginLeft: 8 }}>
          {scoutAccuracyTierLabel(stat.tier)}
        </span>
        <small>
          {formatScoutAccuracyMetric(stat.entriesScored, loaded)} entries ·{" "}
          {formatScoutAccuracyMetric(stat.verifiableEntries, loaded)} verifiable ·{" "}
          {formatScoutAccuracyMetric(stat.accurateEntries, loaded)} accurate ·{" "}
          {hasVerifiable ? formatScoutAccuracyRate(stat.accuracyRate, loaded) : "—"} accuracy rate
        </small>
        <small>
          Accuracy score{" "}
          {formatScoutAccuracyScore(stat.accuracyScore, loaded, { hasVerifiable })}
          /100
          {stat.avgAbsErrorPct != null
            ? ` · avg error ${formatScoutAccuracyRate(stat.avgAbsErrorPct, loaded)}`
            : ""}
          {stat.suggestedPromote ? " · suggested for pick-desk rotation" : ""}
        </small>
      </div>
      {eventKey ? (
        <Button variant="secondary" type="button" disabled={busy} onClick={() => void mutate({ action: "set-promotion", eventKey, scoutUserId: stat.scoutUserId, promoted: !stat.promoted, }) }>
          {stat.promoted ? "Remove from rotation" : "Promote to rotation"}
        </Button>
      ) : null}
    </li>
  );
}
