"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  PICK_CLOCK_RELATED_INCLUDE,
  classifyPickClockShell,
  formatPickClockMetric,
  pickClockNextActions,
  pickClockRelatedLinks,
  pickClockSetupSteps,
  pickClockShellCopy,
  shouldShowPickClockSummaryTiles,
  type PickClockNextAction,
  type PickClockShellKind,
} from "../../lib/strategy/pick-clock-related";
import {
  clockRemaining,
  clockUrgency,
  PICK_CLOCK_SECONDS,
  type PickClockRecommendation,
} from "../../lib/strategy/pick-clock";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./pick-clock.css";

type PickClockView =
  | {
      status: "ready";
      orgId: string;
      eventKey: string;
      eventName: string | null;
      teamNumber: number | null;
      pickListId: string | null;
      pickListName: string | null;
      sources: string[];
      pickMode: "full" | "low_data_tba";
      pickModeReason: string | null;
      scoutedTeams: number;
      teamCount: number;
      epaDrifts: Array<{ teamKey: string; label: string; delta: number }>;
      excludedTeamKeys: string[];
      recommendation: PickClockRecommendation | null;
      alternates: PickClockRecommendation[];
      availableCount: number;
      excludedCount: number;
    }
  | {
      status: "setup_required";
      message: string;
      orgId: string | null;
      eventKey: string | null;
    };

type Me = { orgId?: string | null };

function teamDisplay(rec: PickClockRecommendation): string {
  if (rec.teamNumber != null) return String(rec.teamNumber);
  return rec.teamKey.replace(/^frc/i, "") || rec.teamKey;
}

function ReasonList({ reasons }: { reasons: PickClockRecommendation["reasons"] }) {
  if (!reasons.length) return null;
  return (
    <ul className="pck-reasons">
      {reasons.map((reason) => (
        <li key={reason.label} className={`pck-reason ${reason.tone}`}>
          {reason.label}
        </li>
      ))}
    </ul>
  );
}

function PickClockRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = pickClockRelatedLinks(orgId, {
    include: [...PICK_CLOCK_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related pck-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function PickClockNextActionsPanel({ actions }: { actions: PickClockNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions pck-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Strategy, Pick desk, and Chemistry — never DEMO picks.</p>
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

function PickClockShell({
  orgId,
  shell,
  error,
  errorStatus,
  onRetry,
  children,
}: {
  orgId?: string | null;
  shell: PickClockShellKind;
  error?: string;
  /** HTTP status of the failed load, so an expired session offers sign-in, not Retry. */
  errorStatus?: number | null;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = pickClockNextActions({ orgId, shell });
  const copy = pickClockShellCopy(shell);
  // A failed load names its own recovery — Retry cannot fix an expired session.
  const failure =
    shell === "error"
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error || copy.description,
          },
        )
      : null;
  const steps = shell === "setup" ? pickClockSetupSteps(orgId) : [];
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const pickDeskHref = withOrgHref("/strategy?tab=picks", orgId);
  const chemistryHref = hubHref("/competition", "chemistry", orgId);
  const commandHref = hubHref("/competition", "command", orgId);
  const teamDataHref = withOrgHref("/team/data", orgId);

  return (
    <main className="module-page app-shell-page pck-page pck-workbench soft-gate">
      <PageHeader
        breadcrumbs="Competition / Pick clock"
        title="Pick Clock"
        description="Next best pick + why — built for the 45-second alliance selection timer. Never invents DEMO picks or EPA."
      >
        <PickClockRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        className="pck-empty"
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No teams left to recommend"
                : copy.badge
        }
        badgeTone="setup"
        title={failure ? failure.title : copy.title}
        description={failure ? failure.description : error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {failure?.primary ? (
          <a className="app-button" href={failure.primary.href}>
            {failure.primary.label}
          </a>
        ) : null}
        {shell === "error" && onRetry && failure?.showRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? commandHref : "/workspace"}>
            {orgId ? "Set active event" : "Select workspace"}
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href={teamDataHref}>
              Sync event metrics
            </a>
            <a className="app-button secondary" href={strategyHref}>
              Open Strategy
            </a>
            <a className="app-button secondary" href={pickDeskHref}>
              Open Pick desk
            </a>
            <a className="app-button secondary" href={chemistryHref}>
              Open Chemistry
            </a>
          </>
        ) : null}
      </EmptyState>
      {steps.length > 0 ? (
        <Panel className="pck-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Strategy, Pick desk, and Chemistry — never DEMO picks.</p>
          </header>
          <ul className="pck-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <PickClockNextActionsPanel actions={actions} />
    </main>
  );
}

export default function PickClockClient(_props: { embedded?: boolean } = {}) {
  const [orgId, setOrgId] = useState("");
  const [view, setView] = useState<PickClockView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [skipOffset, setSkipOffset] = useState(0);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("orgId") ?? "";
    void fetch("/api/me")
      .then(async (r) => (r.ok ? ((await r.json()) as Me) : null))
      .then((data) => {
        if (!data) {
          setLoading(false);
          return;
        }
        setOrgId(fromUrl || data.orgId || "");
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const load = useCallback(async (id: string) => {
    if (!id) {
      setLoading(false);
      setFetchFailed(false);
      return;
    }
    setLoading(true);
    setFetchFailed(false);
    setErrorStatus(null);
    try {
      // The ONE pick list owns the draft board, so anything the alliance-selection desk has
      // already picked must leave the clock's available pool. A board that has not been opened
      // yet returns an empty list — never a fabricated exclusion.
      let draftedTeamKeys: string[] = [];
      try {
        const boardResponse = await fetch(`/api/picklist/board?orgId=${encodeURIComponent(id)}`);
        if (boardResponse.ok) {
          const board = (await boardResponse.json()) as { draftedTeamKeys?: string[] };
          if (Array.isArray(board.draftedTeamKeys)) draftedTeamKeys = board.draftedTeamKeys;
        }
      } catch {
        // Board unavailable — fall through with no extra exclusions rather than blocking a pick.
      }

      const excludeParams = draftedTeamKeys
        .map((key) => `&exclude=${encodeURIComponent(key)}`)
        .join("");
      const response = await fetch(
        `/api/strategy/pick-clock?orgId=${encodeURIComponent(id)}${excludeParams}`,
      );
      const data = (await response.json()) as PickClockView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load pick clock.");
        setErrorStatus(response.status);
        setView(null);
        setFetchFailed(true);
        setLoading(false);
        return;
      }
      setError("");
      setView(data);
      setFetchFailed(false);
      setSkipOffset(0);
      if (data.status === "ready" && data.orgId) setOrgId(data.orgId);
      if (data.status === "setup_required" && data.orgId) setOrgId(data.orgId);
    } catch {
      setError("Could not reach the pick clock API.");
      setView(null);
      setFetchFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    void load(orgId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial / org change only
  }, [orgId]);

  useEffect(() => {
    if (startedAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const remaining = clockRemaining(startedAt, now);
  const urgency = clockUrgency(remaining);

  const hasRecommendation =
    view?.status === "ready" ? Boolean(view.recommendation) : false;
  const availableCount = view?.status === "ready" ? view.availableCount : 0;
  const excludedCount = view?.status === "ready" ? view.excludedCount : 0;

  const shell = classifyPickClockShell({
    loading,
    fetchFailed,
    status: view?.status ?? (!orgId && !loading ? "setup_required" : null),
    orgId: view?.status === "ready" ? view.orgId : view?.orgId ?? (orgId || null),
    eventKey: view?.status === "ready" ? view.eventKey : view?.eventKey ?? null,
    hasRecommendation,
    availableCount,
  });

  if (shell === "loading" || shell === "error" || shell === "setup") {
    return (
      <PickClockShell
        orgId={
          view?.status === "ready"
            ? view.orgId
            : view?.orgId ?? (orgId || null)
        }
        shell={shell}
        errorStatus={errorStatus}
        error={
          shell === "error"
            ? error || "Could not load pick clock."
            : shell === "setup" && view?.status === "setup_required" && view.message
              ? `${view.message} Recommendations stay blank until real event metrics exist — never DEMO picks.`
              : undefined
        }
        onRetry={
          shell === "error" && orgId
            ? () => {
                void load(orgId);
              }
            : undefined
        }
      />
    );
  }

  const resolvedOrgId =
    view?.status === "ready" ? view.orgId : view?.orgId ?? (orgId || null);
  const strategyHref = hubHref("/competition", "strategy", resolvedOrgId);
  const pickDeskHref = withOrgHref("/strategy?tab=picks", resolvedOrgId);
  const chemistryHref = hubHref("/competition", "chemistry", resolvedOrgId);
  const showTiles = shouldShowPickClockSummaryTiles(availableCount);
  const readyActions = pickClockNextActions({
    orgId: resolvedOrgId,
    shell: hasRecommendation && availableCount > 0 ? "ready" : "empty",
    eventKey: view?.status === "ready" ? view.eventKey : view?.eventKey,
    hasRecommendation,
    availableCount,
    excludedCount,
  });

  if (shell === "empty" || !view || view.status !== "ready") {
    return (
      <PickClockShell
        orgId={resolvedOrgId}
        shell="empty"
        error={
          excludedCount > 0
            ? `${excludedCount} already taken on the draft board. Clear slots or refresh after updates — never DEMO picks.`
            : undefined
        }
      />
    );
  }

  const queue = view.recommendation
    ? [view.recommendation, ...view.alternates]
    : [];
  const active = queue[Math.min(skipOffset, Math.max(0, queue.length - 1))] ?? null;

  return (
    <main className="module-page app-shell-page pck-page pck-workbench">
      <PageHeader
        breadcrumbs="Competition / Pick clock"
        title="Pick Clock"
        description={
          view.eventName
            ? `${view.eventName} · ${PICK_CLOCK_SECONDS}s selection clock — never DEMO picks.`
            : `${PICK_CLOCK_SECONDS}-second alliance pick assistant — never DEMO picks.`
        }
      >
        <div className="pck-heading">
          <PickClockRelatedStrip orgId={resolvedOrgId} />
          <div className="pck-header-actions">
            <button
              type="button"
              className="app-button secondary"
              onClick={() => {
                if (resolvedOrgId) void load(resolvedOrgId);
              }}
            >
              Refresh
            </button>
            <a className="app-button secondary" href={strategyHref}>
              Strategy
            </a>
            <a className="app-button secondary" href={pickDeskHref}>
              Pick desk
            </a>
            <a className="app-button secondary" href={chemistryHref}>
              Chemistry
            </a>
          </div>
        </div>
      </PageHeader>

      {error ? <p className="edc-banner error">{error}</p> : null}

      {showTiles ? (
        <div className="pck-kpis" aria-label="Pick clock counts">
          <article>
            <strong>{formatPickClockMetric(availableCount, true)}</strong>
            <small>available</small>
          </article>
          <article>
            <strong>
              {formatPickClockMetric(view.scoutedTeams, true)}/
              {formatPickClockMetric(view.teamCount, true)}
            </strong>
            <small>scouted</small>
          </article>
          <article>
            <strong>{formatPickClockMetric(excludedCount, true)}</strong>
            <small>already taken</small>
          </article>
        </div>
      ) : null}

      {view.pickMode === "low_data_tba" ? (
        <p className="pck-mode-banner" role="status">
          <span className="app-badge setup">Low-data TBA</span>
          {view.pickModeReason ?? "Ranking from TBA/Statbotics until scouting coverage improves — never DEMO picks."}
        </p>
      ) : null}

      <div className={`pck-clock pck-${urgency}`} aria-live="polite">
        <span className="pck-clock-label">{remaining == null ? "Ready" : "Seconds left"}</span>
        <strong className="pck-clock-value">{remaining == null ? PICK_CLOCK_SECONDS : remaining}</strong>
        <div className="pck-clock-actions">
          {startedAt == null ? (
            <button
              type="button"
              className="app-button"
              onClick={() => {
                setStartedAt(Date.now());
                setNow(Date.now());
              }}
            >
              Start {PICK_CLOCK_SECONDS}s
            </button>
          ) : (
            <button
              type="button"
              className="app-button secondary"
              onClick={() => {
                setStartedAt(Date.now());
                setNow(Date.now());
              }}
            >
              Reset clock
            </button>
          )}
        </div>
      </div>

      {!active ? (
        <EmptyState
          soft
          className="pck-empty"
          title="No teams left to recommend"
          description={
            excludedCount
              ? `${excludedCount} already taken on the draft board. Clear slots or refresh after updates — never DEMO picks.`
              : "Load event metrics or build a pick list on Strategy first — no invented rankings."
          }
          badge="No teams left to recommend"
          badgeTone="setup"
        >
          <div className="pck-setup-links">
            <a className="app-button" href={pickDeskHref}>
              Open Pick desk
            </a>
            <a className="app-button secondary" href={strategyHref}>
              Open Strategy
            </a>
            <a className="app-button secondary" href={chemistryHref}>
              Open Chemistry
            </a>
          </div>
        </EmptyState>
      ) : (
        <section className="pck-hero soft-panel" aria-label="Next best pick">
          <p className="pck-eyebrow">
            Next pick
            {view.pickListName ? ` · ${view.pickListName}` : ""}
            {view.availableCount ? ` · ${view.availableCount} available` : ""}
            {view.scoutedTeams != null && view.teamCount
              ? ` · ${view.scoutedTeams}/${view.teamCount} scouted`
              : ""}
          </p>
          <h2 className="pck-team-number">{teamDisplay(active)}</h2>
          {active.nickname ? <p className="pck-nickname">{active.nickname}</p> : null}
          <p className="pck-headline">{active.headline}</p>
          {active.epaDrift?.divergent ? (
            <p className="pck-drift" role="status">
              {active.epaDrift.label}
            </p>
          ) : null}
          <ReasonList reasons={active.reasons} />

          <div className="pck-tools">
            <button
              type="button"
              className="app-button secondary"
              disabled={queue.length < 2}
              onClick={() => setSkipOffset((n) => (n + 1) % queue.length)}
            >
              Show alternate
            </button>
            <a
              className="app-button secondary"
              href={withOrgHref(
                `/dossier?team=${encodeURIComponent(
                  active.teamNumber != null
                    ? String(active.teamNumber)
                    : active.teamKey.replace(/^frc/i, ""),
                )}`,
                resolvedOrgId,
              )}
            >
              Dossier
            </a>
            <a
              className="app-button secondary"
              href={withOrgHref(
                `/chemistry?teams=${encodeURIComponent(teamDisplay(active))}`,
                resolvedOrgId,
              )}
            >
              Chemistry
            </a>
          </div>
        </section>
      )}

      {queue.length > 1 ? (
        <section className="pck-alts" aria-label="Quick alternates">
          <h3>Also ready</h3>
          <ul>
            {queue
              .filter((_, index) => index !== Math.min(skipOffset, queue.length - 1))
              .map((alt) => (
                <li key={alt.teamKey}>
                  <button
                    type="button"
                    onClick={() => setSkipOffset(queue.findIndex((row) => row.teamKey === alt.teamKey))}
                  >
                    <strong>{teamDisplay(alt)}</strong>
                    <span>{alt.headline}</span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <PickClockNextActionsPanel actions={readyActions} />

      {view.sources.length ? (
        <p className="pck-sources app-muted">
          Signals: {view.sources.join(" · ")}
          {view.pickMode === "low_data_tba" ? " · quick-pick mode" : " · pick-desk scoring"}
          {view.epaDrifts.length
            ? ` · ${view.epaDrifts.length} EPA-drift callout${view.epaDrifts.length === 1 ? "" : "s"}`
            : ""}
          {" · never DEMO picks"}
        </p>
      ) : null}
    </main>
  );
}
