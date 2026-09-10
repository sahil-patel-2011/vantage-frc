"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
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
import "./scout-accuracy.css";

function tierTone(tier: ScoutAccuracyTier): "good" | "setup" | "" {
  if (tier === "lead") return "good";
  if (tier === "core") return "setup";
  return "";
}

type LiveView = Extract<ScoutAccuracyView, { status: "live" }>;

function ScoutAccuracyRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = scoutAccuracyRelatedLinks(orgId, {
    include: [...SCOUT_ACCURACY_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related scout-accuracy-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
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
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
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
  const steps = shell === "setup" ? scoutAccuracySetupSteps(orgId) : [];
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
          <a className="app-button" href={failure.primary.href}>
            {failure.primary.label}
          </a>
        ) : null}
        {failure?.showRetry && onRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button is-primary" href={orgId ? scoutingHref : "/workspace"}>
            {orgId ? "Open Scouting" : "Choose your team"}
          </a>
        ) : null}
        {shell === "empty" ? (
          <a className="app-button is-primary" href={scoutingHref}>
            Log scout entries
          </a>
        ) : null}
      </EmptyState>
      {steps.length > 0 ? (
        <Panel className="scout-accuracy-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="scout-accuracy-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted scout-accuracy-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {steps.length === 0 ? <ScoutAccuracyNextActionsPanel actions={actions} /> : null}
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

  const orgId = (view && "orgId" in view ? view.orgId : null) ?? initialOrgId ?? null;

  const load = useCallback((eventOverride?: string) => {
    setFetchFailed(false);
    setFailureStatus(null);
    setError("");
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const urlOrg = initialOrgId ?? params.get("orgId");
    const eventQuery = eventOverride ?? params.get("eventKey");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (eventQuery) query.set("eventKey", eventQuery);
    void fetch(`/api/scout-accuracy${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ScoutAccuracyView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          setFailureStatus(response.status);
          setError("error" in data && data.error ? data.error : "Could not load scout accuracy.");
          return;
        }
        setView(data);
        setFetchFailed(false);
      })
      .catch(() => {
        setFetchFailed(true);
        setError("Network error — please try again.");
      });
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
        });
        const data = (await response.json()) as ScoutAccuracyView | { error?: string };
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
    return <ScoutAccuracyShell description={shellCopy.description} orgId={orgId} shell="loading" />;
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
      />
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
      />
    );
  }

  if (shell === "empty" || view?.status !== "live") {
    return <ScoutAccuracyShell description={shellCopy.description} orgId={orgId} shell="empty" />;
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
            <button
              type="button"
              className="app-button secondary"
              disabled={busy}
              onClick={() => void mutate({ action: "record-snapshot", eventKey: view.eventKey })}
            >
              Record snapshot
            </button>
          ) : null}
        </div>
      </PageHeader>

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
        <small>membership-bound</small>
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
        <small>pick-desk ready</small>
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
        <a className="app-button is-primary" href={hubHref("/competition", "scouting", view.orgId)}>
          Open Scouting
        </a>
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
        <button
          type="button"
          className="app-button secondary"
          disabled={busy}
          onClick={() =>
            void mutate({
              action: "set-promotion",
              eventKey,
              scoutUserId: stat.scoutUserId,
              promoted: !stat.promoted,
            })
          }
        >
          {stat.promoted ? "Remove from rotation" : "Promote to rotation"}
        </button>
      ) : null}
    </li>
  );
}
