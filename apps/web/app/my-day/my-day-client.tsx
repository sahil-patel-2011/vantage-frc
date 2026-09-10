"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, PageHeader, Panel } from "../../components/ui";
import type { MyDayMatch, MyDayView } from "../../lib/my-day";
import {
  MY_DAY_RELATED_INCLUDE,
  classifyMyDayShell,
  formatMyDayMatchCount,
  myDayNextActions,
  myDayRelatedLinks,
  myDaySetupSteps,
  myDayShellCopy,
  type MyDayNextAction,
  type MyDayShellKind,
} from "../../lib/my-day-related";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { useCockpitPrefs } from "../../lib/cockpit/use-cockpit-prefs";
import { MY_DAY_POLL_MS, mergeMyDayView, shouldPollMyDay } from "../../lib/my-day/poll";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";

function MyDayRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = myDayRelatedLinks(orgId, {
    include: [...MY_DAY_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related myday-related" aria-label="Related live ops tools">
      {links.map((link) => (
        <Button key={link.id} as="a" variant="secondary" href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function MyDayNextActionsPanel({ actions }: { actions: MyDayNextAction[] }) {
  if (!actions.length) return null;
  return (
    <Panel className="myday-next-actions">
      <header>
        <h2>Next actions</h2>
        <p>Event Day, Schedule, and Strategy stay empty until a match is synced.</p>
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
    </Panel>
  );
}

function ScoutChips({
  label,
  chips,
}: {
  label: string;
  chips: Array<{ teamKey: string; teamNumber: string; href: string }>;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="myday-chip-row">
      <span className="myday-chip-label">{label}</span>
      <ul className="myday-chips">
        {chips.map((chip) => (
          <li key={chip.teamKey}>
            <a className="myday-chip" href={chip.href}>
              {chip.teamNumber}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MatchHero({ match, orgId }: { match: MyDayMatch; orgId?: string | null }) {
  const commandHref = hubHref("/competition", "command", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const scheduleHref = withOrgHref("/schedule", orgId);
  return (
    <section className={`myday-hero alliance-${match.alliance}`} aria-live="polite">
      <p className="myday-hero-kicker">Next match</p>
      <h2 className="myday-hero-title">{match.matchLabel}</h2>
      <p className="myday-hero-time">{match.timeLabel}</p>
      <p className={`myday-bumper alliance-${match.alliance}`}>{match.bumperCue}</p>
      <ScoutChips label="With" chips={match.links.scoutPartners} />
      <ScoutChips label="Vs" chips={match.links.scoutOpponents} />
      <nav className="myday-hero-links" aria-label="Match links">
        <a className="myday-link primary" href={commandHref}>
          Event Day
        </a>
        <a className="myday-link" href={scheduleHref}>
          Schedule
        </a>
        <a className="myday-link" href={strategyHref}>
          Strategy
        </a>
        <a className="myday-link" href={match.links.briefing}>
          Briefing
        </a>
        <a className="myday-link" href={match.links.checklist}>
          Checklist
        </a>
      </nav>
    </section>
  );
}

function MatchCard({ match }: { match: MyDayMatch }) {
  return (
    <li className={`myday-card alliance-${match.alliance}${match.isNext ? " next" : ""}`}>
      <div className="myday-card-top">
        <strong>{match.matchLabel}</strong>
        <span>{match.timeLabel}</span>
      </div>
      <p className={`myday-bumper sm alliance-${match.alliance}`}>{match.bumperCue}</p>
      <ScoutChips label="With" chips={match.links.scoutPartners} />
      <ScoutChips label="Vs" chips={match.links.scoutOpponents} />
      {match.scored ? (
        <p className="myday-score">
          {match.redScore} – {match.blueScore}
        </p>
      ) : null}
    </li>
  );
}

function MyDayShell({
  orgId,
  shell,
  emptyReason,
  hasActiveEvent,
  error,
  errorStatus,
  onRetry,
  embedded = false,
  fromCache = false,
  cachedAt = null,
  children,
}: {
  orgId?: string | null;
  shell: MyDayShellKind;
  emptyReason?: "no_schedule" | "no_upcoming" | null;
  hasActiveEvent?: boolean;
  error?: string;
  errorStatus?: number | null;
  onRetry?: () => void;
  embedded?: boolean;
  fromCache?: boolean;
  cachedAt?: string | null;
  children?: ReactNode;
}) {
  const actions = myDayNextActions({
    orgId,
    shell,
    emptyReason,
    hasActiveEvent,
  });
  const copy = myDayShellCopy(shell, { emptyReason });
  const setup = shell === "setup" ? myDaySetupSteps(orgId)[0] : null;
  // A signed-out tablet needs "Sign in again", not a Retry that can never succeed.
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
            message: error,
          },
        )
      : null;
  const commandHref = hubHref("/competition", "command", orgId);
  const scheduleHref = withOrgHref("/schedule", orgId);

  return (
    <main className={`module-page myday-page soft-gate${embedded ? " is-embedded" : ""}`}>
      {embedded ? null : (
      <PageHeader
        breadcrumbs="Competition / Live ops"
        title="My Day"
        description="Your next match, bumper color, partners, and opponents from The Blue Alliance."
      >
        <MyDayRelatedStrip orgId={orgId} />
      </PageHeader>
      )}
      <OfflineBanner feature="My Day" fromCache={fromCache} cachedAt={cachedAt} />
      {children}
      <EmptyState
        soft
        className="myday-empty"
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? copy.badge
                : copy.badge
        }
        badgeTone="setup"
        title={failure ? failure.title : copy.title}
        description={failure ? failure.description : error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {failure?.primary ? (
          <Button as="a" variant="primary" href={failure.primary.href}>
            {failure.primary.label}
          </Button>
        ) : null}
        {shell === "error" && onRetry && (failure?.showRetry ?? true) ? (
          <Button type="button" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {setup ? (
          <Button as="a" variant="primary" href={setup.href}>
            {setup.label}
          </Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href={emptyReason === "no_upcoming" ? scheduleHref : commandHref}>
            {emptyReason === "no_upcoming" ? "Open Schedule" : "Open Event Day"}
          </Button>
        ) : null}
      </EmptyState>
      {embedded || shell !== "ready" ? null : <MyDayNextActionsPanel actions={actions} />}
    </main>
  );
}

export default function MyDayClient({ embedded = false }: { embedded?: boolean } = {}) {
  const cockpit = useCockpitPrefs();
  const [view, setView] = useState<MyDayView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<MyDayView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId") ?? "";
    const cached = orgId ? await getFeatureSnapshot<MyDayView>("my-day", orgId) : null;
    if (!viewRef.current && cached?.data) {
      setView(cached.data);
      setFromCache(true);
      setCachedAt(cached.cachedAt);
      setLoading(false);
    }
    const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
    try {
      const response = await fetch(`/api/my-day${qs}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as MyDayView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load My Day.");
        setErrorStatus(response.status);
        if (!viewRef.current && !cached) setFetchFailed(true);
        return;
      }
      setError("");
      setErrorStatus(null);
      setFetchFailed(false);
      setView((current) => mergeMyDayView(current, data));
      setFromCache(false);
      setCachedAt(null);
      const cacheOrg = data.context.orgId || orgId;
      if (cacheOrg) await putFeatureSnapshot("my-day", cacheOrg, data);
    } catch {
      if (!viewRef.current && !cached) {
        setError("Could not load My Day.");
        setErrorStatus(null);
        setFetchFailed(true);
      } else {
        setError("Could not refresh My Day.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (shouldPollMyDay(document.visibilityState, cockpit.pauseLiveWhenHidden)) void load();
    }, MY_DAY_POLL_MS);
    const onVisibility = () => {
      if (shouldPollMyDay(document.visibilityState, cockpit.pauseLiveWhenHidden)) void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, cockpit.pauseLiveWhenHidden]);

  if (loading && !view) {
    return (
      <MyDayShell
        shell={classifyMyDayShell({ loading: true })}
        error={undefined}
        embedded={embedded}
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
  }

  if ((fetchFailed || error) && !view) {
    return (
      <MyDayShell
        shell="error"
        error={error || undefined}
        errorStatus={errorStatus}
        embedded={embedded}
        fromCache={fromCache}
        cachedAt={cachedAt}
        onRetry={() => {
          setLoading(true);
          setFetchFailed(false);
          setErrorStatus(null);
          void load();
        }}
      />
    );
  }

  if (!view || view.status === "setup_required") {
    const orgId = view?.context.orgId ?? null;
    return (
      <MyDayShell
        orgId={orgId}
        shell="setup"
        hasActiveEvent={Boolean(view?.context.eventKey)}
        error={view?.status === "setup_required" ? view.message : undefined}
        embedded={embedded}
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
  }

  const orgId = view.context.orgId;
  const shell = classifyMyDayShell({
    status: "ready",
    emptyReason: view.emptyReason,
    ourMatchCount: view.freshness.ourMatchCount,
  });

  if (shell === "empty") {
    return (
      <MyDayShell
        orgId={orgId}
        shell="empty"
        emptyReason={view.emptyReason}
        hasActiveEvent={Boolean(view.context.eventKey)}
        embedded={embedded}
        fromCache={fromCache}
        cachedAt={cachedAt}
      >
        <p className="myday-freshness" role="status">
          {view.freshness.label}
          {" · "}
          {formatMyDayMatchCount(view.freshness.matchCount, true)} event matches
        </p>
      </MyDayShell>
    );
  }

  const commandHref = hubHref("/competition", "command", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const scheduleHref = withOrgHref("/schedule", orgId);
  const nextActions = myDayNextActions({ orgId, shell: "ready" });

  return (
    <main className={`module-page myday-page${embedded ? " is-embedded" : ""}`}>
      {embedded ? null : (
      <PageHeader
        breadcrumbs="Competition / Live ops"
        title="My Day"
        description={
          view.context.eventName
            ? `${view.context.eventName}${view.context.teamNumber != null ? ` · Team ${view.context.teamNumber}` : ""}`
            : "Your matches at the active event."
        }
      >
        <MyDayRelatedStrip orgId={orgId} />
      </PageHeader>
      )}

      <OfflineBanner feature="My Day" fromCache={fromCache} cachedAt={cachedAt} />

      <p className="myday-freshness" role="status">
        {view.freshness.label}
        {view.freshness.ourMatchCount > 0
          ? ` · ${formatMyDayMatchCount(view.freshness.ourMatchCount, true)} of our matches`
          : null}
      </p>

      {error ? (
        <p className="myday-warn" role="status">
          {error} Showing the last good load.
        </p>
      ) : null}

      {view.next ? <MatchHero match={view.next} orgId={orgId} /> : null}

      {view.matches.length > 0 ? (
        <section className="myday-list-section">
          <h2>Our matches</h2>
          <ul className="myday-list">
            {view.matches.map((match) => (
              <MatchCard key={match.matchKey} match={match} />
            ))}
          </ul>
        </section>
      ) : null}

      {!view.next && view.matches.length > 0 ? (
        <nav className="myday-hero-links" aria-label="Live ops links">
          <a className="myday-link primary" href={commandHref}>
            Event Day
          </a>
          <a className="myday-link" href={scheduleHref}>
            Schedule
          </a>
          <a className="myday-link" href={strategyHref}>
            Strategy
          </a>
        </nav>
      ) : null}

      {embedded ? null : <MyDayNextActionsPanel actions={nextActions} />}
    </main>
  );
}
