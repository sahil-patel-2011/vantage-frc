"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EmptyState, PageHeader } from "../../components/ui";
import type { MyDayMatch, MyDayView } from "../../lib/my-day";
import {
  classifyMyDayShell,
  formatMyDayMatchCount,
  myDayShellCopy,
  type MyDayShellKind,
} from "../../lib/my-day-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { useCockpitPrefs } from "../../lib/cockpit/use-cockpit-prefs";
import { MY_DAY_POLL_MS, mergeMyDayView, shouldPollMyDay } from "../../lib/my-day/poll";

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

function MatchHero({ match }: { match: MyDayMatch }) {
  return (
    <section className={`myday-hero alliance-${match.alliance}`} aria-live="polite">
      <p className="myday-hero-kicker">Next match</p>
      <h2 className="myday-hero-title">{match.matchLabel}</h2>
      <p className="myday-hero-time">{match.timeLabel}</p>
      <p className={`myday-bumper alliance-${match.alliance}`}>{match.bumperCue}</p>
      <ScoutChips label="With" chips={match.links.scoutPartners} />
      <ScoutChips label="Vs" chips={match.links.scoutOpponents} />
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
  hasActiveEvent: _hasActiveEvent,
  error,
  errorStatus,
  onRetry,
  embedded = false,
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
  children?: ReactNode;
}) {
  const copy = myDayShellCopy(shell, { emptyReason });
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
  const workspaceHref = orgId ? withOrgHref("/workspace", orgId) : "/workspace";
  const teamDataHref = withOrgHref("/team/data", orgId);
  const commandHref = hubHref("/competition", "command", orgId);
  const scheduleHref = withOrgHref("/schedule", orgId);

  return (
    <main className={`module-page myday-page soft-gate${embedded ? " is-embedded" : ""}`}>
      {embedded ? null : (
      <PageHeader
        breadcrumbs="Competition / Live ops"
        title="My Day"
        description="Your next match, bumper color, partners, and opponents from The Blue Alliance."
      />
      )}
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
          <a className="app-button" href={failure.primary.href}>
            {failure.primary.label}
          </a>
        ) : null}
        {shell === "error" && onRetry && (failure?.showRetry ?? true) ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? teamDataHref : workspaceHref}>
            {orgId ? "Sync Team Data" : "Select workspace"}
          </a>
        ) : null}
        {shell === "empty" ? (
          <a className="app-button" href={emptyReason === "no_upcoming" ? scheduleHref : commandHref}>
            {emptyReason === "no_upcoming" ? "Open Schedule" : "Open Event Day"}
          </a>
        ) : null}
      </EmptyState>
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

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
    try {
      const response = await fetch(`/api/my-day${qs}`, { cache: "no-store" });
      const data = (await response.json()) as MyDayView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load My Day.");
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
      setError("");
      setErrorStatus(null);
      setFetchFailed(false);
      setView((current) => mergeMyDayView(current, data));
    } catch {
      setError("Could not load My Day.");
      setErrorStatus(null);
      setFetchFailed(true);
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
      >
        <p className="myday-freshness" role="status">
          {view.freshness.label}
          {" · "}
          {formatMyDayMatchCount(view.freshness.matchCount, true)} event matches
        </p>
      </MyDayShell>
    );
  }

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
      />
      )}

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

      {view.next ? <MatchHero match={view.next} /> : null}

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

    </main>
  );
}
