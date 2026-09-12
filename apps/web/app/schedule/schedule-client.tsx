"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AiInsightPanel } from "../../components/ai-insight-panel";
import { OfflineBanner } from "../../components/offline-banner";
import { ScheduleRelated } from "../../components/schedule-related";
import { Button, EmptyState, Panel } from "../../components/ui";
import { ExportButton, type CsvColumn } from "../../components/ui/export-button";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  SCHEDULE_RELATED_INCLUDE,
  scheduleNextActions,
  type ScheduleNextAction,
  type ScheduleShellKind,
} from "../../lib/schedule/schedule-related";
import { useCockpitPrefs } from "../../lib/cockpit/use-cockpit-prefs";
import {
  SCHEDULE_POLL_MS,
  scheduleCacheRequiredCopy,
  shouldRefreshSchedule,
} from "../../lib/schedule/tba-cache";
import {
  allianceOf,
  compLevelLabel,
  fmtMatchTime,
  isScored,
  matchesUntil,
  matchResult,
  nextOurMatch,
  ourMatches,
  splitByLevel,
  stripFrc,
  type ScheduleMatch,
  type ScheduleView,
} from "../../lib/schedule-board";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";

/**
 * CSV shape of the match board. One row per match with the alliances flattened into
 * six team columns, because that is the shape a strategy spreadsheet pivots on.
 * `teamKey` is threaded through so "our alliance" / "our result" are filled in for
 * the team's own team and left blank when no team number is set.
 */
function scheduleCsvColumns(teamKey: string | null): CsvColumn<ScheduleMatch>[] {
  const slot = (side: "red" | "blue", index: number): CsvColumn<ScheduleMatch> => ({
    key: `${side}${index + 1}`,
    header: `${side === "red" ? "Red" : "Blue"} ${index + 1}`,
    value: (match) => {
      const key = match[side][index];
      return key ? stripFrc(key) : null;
    },
  });
  return [
    {
      key: "match",
      header: "Match",
      hint: "Level and number as shown on the board",
      value: (match) => `${compLevelLabel(match.compLevel)} ${match.matchNumber}`,
    },
    { key: "compLevel", header: "Comp level", hint: "Raw official level (qm/qf/sf/f)", value: (match) => match.compLevel },
    { key: "matchNumber", header: "Match number", value: (match) => match.matchNumber },
    {
      key: "scheduledTime",
      header: "Scheduled time",
      hint: "ISO-8601 UTC — sortable, not a locale string",
      value: (match) => match.scheduledTime,
    },
    ...[0, 1, 2].map((index) => slot("red", index)),
    ...[0, 1, 2].map((index) => slot("blue", index)),
    { key: "redScore", header: "Red score", value: (match) => match.redScore },
    { key: "blueScore", header: "Blue score", value: (match) => match.blueScore },
    { key: "winner", header: "Winner", hint: "Blank until the match is scored", value: (match) => match.winningAlliance },
    {
      key: "ourAlliance",
      header: "Our alliance",
      hint: "Blank when the match is not ours",
      value: (match) => (teamKey ? allianceOf(match, teamKey) : null),
    },
    {
      key: "ourResult",
      header: "Our result",
      hint: "W / L / T once scored",
      value: (match) => (teamKey ? (matchResult(match, teamKey)?.result ?? null) : null),
    },
    { key: "scoutCount", header: "Scout entries", hint: "Submitted scouting rows for this match", value: (match) => match.scoutCount },
  ];
}

function AllianceTeams({
  keys,
  color,
  teamKey,
  ours,
}: {
  keys: string[];
  color: "red" | "blue";
  teamKey: string | null;
  ours: boolean;
}) {
  return (
    <span className="sched-alliance">
      <i className={`sched-dot ${color}`} aria-hidden="true" />
      {keys.map((key) => (
        <b key={key} className={teamKey != null && key === teamKey ? "sched-team us" : "sched-team"}>
          {stripFrc(key)}
        </b>
      ))}
      {ours ? <i className={`sched-us ${color}`}>US</i> : null}
    </span>
  );
}

function MatchRow({ match, teamKey, isNext }: { match: ScheduleMatch; teamKey: string | null; isNext: boolean }) {
  const side = teamKey ? allianceOf(match, teamKey) : null;
  const outcome = teamKey ? matchResult(match, teamKey) : null;
  const scored = isScored(match);
  const rowClass = ["sched-row", side ? "ours" : "", isNext ? "next" : ""].filter(Boolean).join(" ");

  return (
    <li className={rowClass}>
      <div className="sched-id">
        <strong>
          {compLevelLabel(match.compLevel)} {match.matchNumber}
        </strong>
        <span className="sched-time">{fmtMatchTime(match.scheduledTime)}</span>
      </div>
      <div className="sched-alliances">
        <AllianceTeams keys={match.red} color="red" teamKey={teamKey} ours={side === "red"} />
        <span className="sched-vs">vs</span>
        <AllianceTeams keys={match.blue} color="blue" teamKey={teamKey} ours={side === "blue"} />
      </div>
      <div className="sched-right">
        {scored ? (
          <span className="sched-score">
            <b className={match.winningAlliance === "red" ? "win" : undefined}>{match.redScore}</b>
            <span className="sched-score-sep">–</span>
            <b className={match.winningAlliance === "blue" ? "win" : undefined}>{match.blueScore}</b>
          </span>
        ) : null}
        {outcome ? <span className={`sched-wlt ${outcome.result.toLowerCase()}`}>{outcome.result}</span> : null}
        {isNext ? <span className="sched-chip ondeck">On deck</span> : null}
        {match.scoutCount > 0 ? (
          <span className="sched-chip">
            {match.scoutCount} {match.scoutCount === 1 ? "scout" : "scouts"}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function ScheduleNextActionsPanel({ actions }: { actions: ScheduleNextAction[] }) {
  if (actions.length === 0) return null;
  return (
    <Panel className="sched-next-actions">
      <header>
        <h2>Next actions</h2>
        <p>Each one opens the page where you finish the work.</p>
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

function ScheduleShell({
  title,
  description,
  orgId,
  shell,
  fetchFailed,
  error,
  errorStatus,
  onRetry,
  fromCache = false,
  cachedAt = null,
  children,
}: {
  title: string;
  description: string;
  orgId?: string | null;
  shell: ScheduleShellKind;
  fetchFailed?: boolean;
  error?: string;
  /** HTTP status of the failed load, so an expired session can offer sign-in. */
  errorStatus?: number | null;
  onRetry?: () => void;
  fromCache?: boolean;
  cachedAt?: string | null;
  children?: ReactNode;
}) {
  const workspaceHref = orgId ? withOrgHref("/workspace", orgId) : "/workspace";
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
            message:
              error ||
              "Check your connection and try again.",
          },
        )
      : null;

  return (
    <main className="module-page sched-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Competition / Schedule</span>
          <h1>Match schedule</h1>
          <p>{description}</p>
        </div>
        <ScheduleRelated orgId={orgId} include={[...SCHEDULE_RELATED_INCLUDE]} />
      </header>
      <OfflineBanner
        feature="Schedule"
        fromCache={fromCache}
        cachedAt={cachedAt}
        detail={
          fetchFailed && !fromCache
            ? "Open Schedule once online so this phone can keep the last match board."
            : undefined
        }
      />
      {children}
      <EmptyState
        soft
        badge={shell === "setup" ? "Setup" : shell === "error" ? "Unavailable" : shell === "empty" ? "No matches yet" : undefined}
        badgeTone={shell === "setup" || shell === "empty" ? "setup" : ""}
        title={failure ? failure.title : title}
        description={failure ? failure.description : description}
        aria-busy={shell === "loading" || undefined}
      >
        {failure?.primary ? (
          <Button as="a" variant="primary" href={failure.primary.href}>
            {failure.primary.label}
          </Button>
        ) : null}
        {failure?.showRetry && onRetry ? (
          <Button type="button" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {shell === "setup" ? (
          <Button as="a" variant="primary" href={workspaceHref}>
            Choose your team
          </Button>
        ) : null}
      </EmptyState>
    </main>
  );
}

export default function ScheduleClient() {
  const cockpit = useCockpitPrefs();
  const [view, setView] = useState<ScheduleView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [scope, setScope] = useState<"all" | "ours">("all");
  const [hidePlayed, setHidePlayed] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const viewRef = useRef<ScheduleView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId") ?? "";
    const cached = orgId ? await getFeatureSnapshot<ScheduleView>("schedule", orgId) : null;
    if (!viewRef.current && cached?.data) {
      setView(cached.data);
      setFromCache(true);
      setCachedAt(cached.cachedAt);
    }
    try {
      const response = await fetch(`/api/schedule${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as ScheduleView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load the match schedule.");
        setFailureStatus(response.status);
        if (!viewRef.current && !cached) setFetchFailed(true);
        return;
      }
      setError("");
      setFailureStatus(null);
      setFetchFailed(false);
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      const cacheOrg = data.context.orgId || orgId;
      if (cacheOrg) await putFeatureSnapshot("schedule", cacheOrg, data);
    } catch {
      if (!viewRef.current && !cached) setFetchFailed(true);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      if (cancelled) return;
      if (
        !shouldRefreshSchedule({
          visibilityState: document.visibilityState,
          inFlight: inFlightRef.current,
          pauseWhenHidden: cockpit.pauseLiveWhenHidden,
        })
      ) {
        return;
      }
      await load();
    };

    void poll();

    const arm = () => {
      timer = window.setTimeout(() => {
        void poll().finally(() => {
          if (!cancelled) arm();
        });
      }, SCHEDULE_POLL_MS);
    };
    arm();

    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, cockpit.pauseLiveWhenHidden]);

  if (!view) {
    return (
      <ScheduleShell
        title={fetchFailed ? "Could not load the match schedule" : "Loading match schedule…"}
        description={
          fetchFailed
            ? "A network or server issue blocked the board. Retry."
            : "Reading the official match cache for your active event…"
        }
        shell={fetchFailed ? "error" : "loading"}
        fetchFailed={fetchFailed}
        error={error}
        errorStatus={failureStatus}
        onRetry={() => void load()}
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
  }

  if (view.status === "setup_required") {
    const orgId = view.context.orgId;
    return (
      <ScheduleShell
        title="Almost there"
        description={view.message}
        orgId={orgId}
        shell="setup"
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
  }

  const orgId = view.context.orgId;
  const teamKey = view.context.teamNumber != null ? `frc${view.context.teamNumber}` : null;
  const next = teamKey ? nextOurMatch(view.matches, teamKey) : null;
  const nextSide = next && teamKey ? allianceOf(next, teamKey) : null;
  const until = next ? matchesUntil(view.matches, next) : 0;
  const partners =
    next && nextSide && teamKey
      ? (nextSide === "red" ? next.red : next.blue).filter((key) => key !== teamKey).map(stripFrc)
      : [];
  const opponents = next && nextSide ? (nextSide === "red" ? next.blue : next.red).map(stripFrc) : [];

  const base = scope === "ours" && teamKey ? ourMatches(view.matches, teamKey) : view.matches;
  const visible = hidePlayed ? base.filter((entry) => !isScored(entry)) : base;
  const groups = splitByLevel(visible);
  const shell: ScheduleShellKind = view.matches.length === 0 ? "empty" : "ready";
  const nextActions = scheduleNextActions({
    orgId,
    shell,
    hasActiveEvent: Boolean(view.context.eventKey),
    matchCount: view.matches.length,
  });
  const eventLabel = view.context.eventName ?? view.context.eventKey ?? "Active event";

  return (
    <main className="module-page sched-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Competition / Schedule</span>
          <h1>Match schedule</h1>
          <p>
            {eventLabel}
            {view.context.teamNumber ? ` — Team ${view.context.teamNumber}` : ""} · {view.matches.length}{" "}
            {view.matches.length === 1 ? "match" : "matches"}
          </p>
        </div>
        <div className="sched-header-actions">
          <ScheduleRelated orgId={orgId} include={[...SCHEDULE_RELATED_INCLUDE]} />
          <Button type="button" variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </header>

      <OfflineBanner
        feature="Schedule"
        fromCache={fromCache}
        cachedAt={cachedAt}
        detail={
          fetchFailed
            ? "Showing the last loaded schedule from this phone when the live board could not refresh."
            : undefined
        }
      />

      {fetchFailed ? (
        <p className="telemetry-status" role="alert">
          {error || "Auto-refresh failed — showing the last loaded schedule."}
        </p>
      ) : null}

      {next && nextSide ? (
        <section className="sched-hero">
          <div className="sched-hero-main">
            <span className="sched-hero-kicker">Your next match</span>
            <strong className="sched-hero-match">
              {compLevelLabel(next.compLevel)} {next.matchNumber}
            </strong>
            <span className="sched-hero-sub">
              {fmtMatchTime(next.scheduledTime) || "Time TBD"} ·{" "}
              {until === 0 ? "you're up next" : `${until} ${until === 1 ? "match" : "matches"} until you're up`}
            </span>
          </div>
          <div className="sched-hero-detail">
            <span className={`sched-alliance-chip ${nextSide}`}>
              {nextSide === "red" ? "Switch to RED bumpers" : "Switch to BLUE bumpers"}
            </span>
            <span className="sched-hero-teams">
              With {partners.length ? partners.join(" · ") : "—"}
              <em> vs {opponents.length ? opponents.join(" · ") : "—"}</em>
            </span>
          </div>
        </section>
      ) : null}

      {view.matches.length === 0 ? (
          <EmptyState
            soft
            badge="No matches yet"
            badgeTone="setup"
            title={scheduleCacheRequiredCopy().title}
            description={scheduleCacheRequiredCopy().description}
          />
      ) : (
        <>
          <div className="sched-controls">
            <div className="sched-toggle" role="group" aria-label="Match filter">
              <button type="button" className={scope === "all" ? "active" : undefined} onClick={() => setScope("all")}>
                All matches
              </button>
              <button
                type="button"
                className={scope === "ours" ? "active" : undefined}
                disabled={!teamKey}
                title={teamKey ? undefined : "Set a team number on Your team to filter"}
                onClick={() => setScope("ours")}
              >
                Our matches
              </button>
            </div>
            <label className="sched-check">
              <input type="checkbox" checked={hidePlayed} onChange={(event) => setHidePlayed(event.target.checked)} />
              Hide played
            </label>
            <ExportButton
              rows={visible}
              columns={scheduleCsvColumns(teamKey)}
              feature="Match schedule"
              orgLabel={view.context.orgName}
              orgId={orgId}
              size="sm"
              provenance={`${eventLabel} — ${scope === "ours" ? "our matches" : "all matches"}${
                hidePlayed ? ", unplayed only" : ""
              }. Cached official schedule.`}
            />
          </div>

          {visible.length === 0 ? (
            <EmptyState
              soft
              title="Nothing matches your filters"
              description="Try showing played matches or switching back to all matches."
            />
          ) : (
            groups.map((group) => (
              <section key={group.level} className="sched-group">
                <h2>
                  {group.label}
                  <span>{group.matches.length}</span>
                </h2>
                <ul>
                  {group.matches.map((entry) => (
                    <MatchRow
                      key={entry.matchKey}
                      match={entry}
                      teamKey={teamKey}
                      isNext={entry.matchKey === next?.matchKey}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}

          <ScheduleNextActionsPanel actions={nextActions} />
        </>
      )}

      <AiInsightPanel
        orgId={view.context.orgId ?? ""}
        kind="model_accuracy"
        title="Prediction accuracy"
        description="How well the strategy model has called played matches — accuracy, calibration, and the biggest miss."
      />
    </main>
  );
}
