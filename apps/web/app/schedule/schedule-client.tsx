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
import { formatSchedulePrediction } from "../../lib/schedule/schedule-predictions";
import {
  groupTimeline,
  isPlayed,
  matchPassesFilter,
  missedCount,
  nextMyAssignment,
  shortMatchLabel,
  type TimelineFilter,
  type TimelineRobot,
} from "../../lib/schedule/match-timeline";
import {
  allianceOf,
  compLevelLabel,
  fmtMatchTime,
  isScored,
  matchesUntil,
  matchResult,
  nextOurMatch,
  stripFrc,
  type ScheduleMatch,
  type ScheduleView,
} from "../../lib/schedule-board";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";

/** The row label: Q12, SF2-1, F2. */
function labelOf(match: ScheduleMatch): string {
  return shortMatchLabel(match.compLevel, match.setNumber ?? null, match.matchNumber);
}

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
      value: (match) => labelOf(match),
    },
    { key: "compLevel", header: "Comp level", hint: "Qualification, playoff, or final", value: (match) => match.compLevel },
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
    {
      key: "unassigned",
      header: "Unassigned robots",
      hint: "Robots with no scout assigned",
      value: (match) => (match.robots ? match.robots.filter((robot) => robot.assignees.length === 0).length : null),
    },
    {
      key: "missed",
      header: "Missed assignments",
      hint: "Assigned scouts with no entry once results posted",
      value: (match) => (match.robots ? missedCount(match) : null),
    },
    { key: "notes", header: "Match notes", value: (match) => match.noteCount ?? null },
    { key: "video", header: "Video", value: (match) => match.video?.url ?? null },
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

function clock(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Times as TBA gave them. Scheduled slot first; the live estimate only when it
 * moved; played / posted once they exist. Nothing is shown that TBA did not send.
 */
function MatchTimes({ match }: { match: ScheduleMatch }) {
  const parts: string[] = [];
  const hasDetail =
    match.plannedTime !== undefined || match.predictedTime !== undefined || match.actualTime !== undefined;
  if (!hasDetail) {
    const legacy = fmtMatchTime(match.scheduledTime);
    return legacy ? <span className="sched-time">{legacy}</span> : null;
  }
  const planned = clock(match.plannedTime);
  const predicted = clock(match.predictedTime);
  if (planned) parts.push(planned);
  if (!isPlayed(match) && predicted && predicted !== planned) parts.push(`est ${predicted}`);
  const actual = clock(match.actualTime);
  if (actual) parts.push(`played ${actual}`);
  const posted = clock(match.postResultTime);
  if (posted) parts.push(`posted ${posted}`);
  if (!parts.length) return null;
  return <span className="sched-time">{parts.join(" · ")}</span>;
}

function RobotCell({
  robot,
  teamKey,
  viewerUserId,
  played,
}: {
  robot: TimelineRobot;
  teamKey: string | null;
  viewerUserId: string | null;
  played: boolean;
}) {
  const isUs = teamKey != null && robot.teamKey === teamKey;
  const mine = viewerUserId != null && robot.assignees.some((person) => person.userId === viewerUserId);
  const className = ["tl-robot", robot.alliance, isUs ? "us" : "", mine ? "mine" : ""].filter(Boolean).join(" ");
  const entries = `${robot.entryCount} ${robot.entryCount === 1 ? "entry" : "entries"}`;
  return (
    <li className={className}>
      <b className="tl-num">
        {stripFrc(robot.teamKey)}
        {isUs ? <span className="sr-only"> (us)</span> : null}
      </b>
      <span className="tl-scouts">
        {robot.assignees.length === 0 ? (
          <span className="tl-unassigned">Unassigned</span>
        ) : (
          robot.assignees.map((person, index) => (
            <span
              key={person.userId}
              className={["tl-scout", person.role, person.missed ? "missed" : "", person.submitted ? "done" : ""]
                .filter(Boolean)
                .join(" ")}
            >
              {index > 0 ? ", " : ""}
              {person.name}
              {person.role === "backup" ? " (backup)" : ""}
              {person.missed ? " — missed" : ""}
            </span>
          ))
        )}
      </span>
      <span
        className={`tl-count${robot.entryCount === 0 && played ? " zero" : ""}`}
        aria-label={entries}
        title={`${entries} from our scouts`}
      >
        {robot.entryCount}
      </span>
    </li>
  );
}

function MatchRow({
  match,
  teamKey,
  viewerUserId,
  isNext,
  isNow,
  orgId,
}: {
  match: ScheduleMatch;
  teamKey: string | null;
  viewerUserId: string | null;
  isNext: boolean;
  isNow: boolean;
  orgId: string | null;
}) {
  const side = teamKey ? allianceOf(match, teamKey) : null;
  const outcome = teamKey ? matchResult(match, teamKey) : null;
  const scored = isScored(match);
  const played = isPlayed(match);
  const robots = match.robots;
  const mine = viewerUserId != null && (robots ?? []).some((robot) => robot.assignees.some((p) => p.userId === viewerUserId));
  const rowClass = ["sched-row", "tl-row", side ? "ours" : "", isNext ? "next" : "", isNow ? "now" : "", mine ? "mine" : ""]
    .filter(Boolean)
    .join(" ");
  const predictQuery = new URLSearchParams({
    matchKey: match.matchKey,
    red: match.red.map(stripFrc).join(","),
    blue: match.blue.map(stripFrc).join(","),
  });
  const predictHref = withOrgHref(`/match-sim?${predictQuery.toString()}`, orgId);
  const notesHref = withOrgHref("/match-notes-timeline", orgId);
  const missed = robots ? missedCount(match) : 0;

  return (
    <li className={rowClass} id={`match-${match.matchKey}`}>
      <div className="tl-head">
        <div className="sched-id">
          <strong title={`${compLevelLabel(match.compLevel)} ${match.matchNumber}`}>{labelOf(match)}</strong>
          <MatchTimes match={match} />
        </div>
        <div className="sched-right">
          {scored ? (
            <span className="sched-score" aria-label={`Official result: red ${match.redScore}, blue ${match.blueScore}`}>
              <b className={match.winningAlliance === "red" ? "win red" : "red"}>{match.redScore}</b>
              <span className="sched-score-sep">–</span>
              <b className={match.winningAlliance === "blue" ? "win blue" : "blue"}>{match.blueScore}</b>
            </span>
          ) : match.prediction ? (
            <span className="sched-prediction">{formatSchedulePrediction(match.prediction)}</span>
          ) : null}
          {outcome ? <span className={`sched-wlt ${outcome.result.toLowerCase()}`}>{outcome.result}</span> : null}
          {isNext ? <span className="sched-chip ondeck">Our next</span> : null}
          {missed > 0 ? <span className="sched-chip missed">{missed} missed</span> : null}
          {match.noteCount ? (
            <a className="sched-chip link" href={notesHref}>
              {match.noteCount} {match.noteCount === 1 ? "note" : "notes"}
            </a>
          ) : null}
          {match.video ? (
            <a
              className="sched-chip link"
              href={match.video.url}
              target="_blank"
              rel="noopener noreferrer"
              title={match.video.source === "tba" ? "Official video (TBA)" : "Video your team indexed"}
            >
              ▶ Video
            </a>
          ) : null}
          {!played ? (
            <Button as="a" variant="ghost" size="sm" href={predictHref} className="sched-predict">
              Predict
            </Button>
          ) : null}
        </div>
      </div>
      {robots && robots.length > 0 ? (
        <div className="tl-robots">
          {(["red", "blue"] as const).map((color) => (
            <ul key={color} className={`tl-alliance ${color}${side === color ? " ours" : ""}`} aria-label={`${color} alliance`}>
              {robots
                .filter((robot) => robot.alliance === color)
                .map((robot) => (
                  <RobotCell
                    key={robot.teamKey}
                    robot={robot}
                    teamKey={teamKey}
                    viewerUserId={viewerUserId}
                    played={scored}
                  />
                ))}
            </ul>
          ))}
        </div>
      ) : (
        <div className="sched-alliances">
          <AllianceTeams keys={match.red} color="red" teamKey={teamKey} ours={side === "red"} />
          <span className="sched-vs">vs</span>
          <AllianceTeams keys={match.blue} color="blue" teamKey={teamKey} ours={side === "blue"} />
        </div>
      )}
    </li>
  );
}

function TimelineSection({
  id,
  title,
  hint,
  matches,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  matches: ScheduleMatch[];
  children: (match: ScheduleMatch) => ReactNode;
}) {
  if (matches.length === 0) return null;
  return (
    <section className={`sched-group tl-group tl-${id}`} id={`timeline-${id}`} aria-labelledby={`timeline-${id}-h`}>
      <h2 id={`timeline-${id}-h`}>
        {title}
        <span>{hint ?? matches.length}</span>
      </h2>
      <ul>{matches.map((match) => children(match))}</ul>
    </section>
  );
}

function MissedAlert({
  matches,
  orgId,
}: {
  matches: ScheduleMatch[];
  orgId: string | null;
}) {
  const rows: Array<{ id: string; label: string; team: string; name: string; covered: boolean }> = [];
  for (const match of matches) {
    for (const robot of match.robots ?? []) {
      for (const person of robot.assignees) {
        if (!person.missed) continue;
        rows.push({
          id: `${match.matchKey}|${robot.teamKey}|${person.userId}`,
          label: labelOf(match),
          team: stripFrc(robot.teamKey),
          name: person.role === "backup" ? `${person.name} (backup)` : person.name,
          covered: robot.entryCount > 0,
        });
      }
    }
  }
  if (rows.length === 0) return null;
  const recent = rows.slice(-6).reverse();
  return (
    <Panel className="tl-missed" role="status">
      <header>
        <h2>
          {rows.length} assigned {rows.length === 1 ? "robot was" : "robots were"} not scouted by their scout
        </h2>
        <p>Results are posted and no entry came from the assigned scout. Most recent first.</p>
      </header>
      <ul>
        {recent.map((row) => (
          <li key={row.id}>
            <strong>
              {row.label} · {row.team}
            </strong>
            <span>
              {row.name}
              {row.covered ? " · someone else covered it" : " · no entry from anyone"}
            </span>
          </li>
        ))}
      </ul>
      <a className="edc-next-action" href={withOrgHref("/scout-coverage-live#missed-assignments", orgId)}>
        <strong>Open the full list on Coverage</strong>
      </a>
    </Panel>
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
            <a className="edc-next-action" href={action.href}>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </a>
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
        badge={shell === "setup" ? "Needs setup" : shell === "error" ? "Unavailable" : shell === "empty" ? "No matches yet" : undefined}
        badgeTone={shell === "setup" ? "setup" : ""}
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

const FILTER_LABELS: Record<TimelineFilter, string> = {
  all: "All matches",
  ours: "Our matches",
  mine: "My assignments",
};

export default function ScheduleClient() {
  const cockpit = useCockpitPrefs();
  const [view, setView] = useState<ScheduleView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [hidePlayed, setHidePlayed] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  // Re-evaluated on every poll so "now" moves as the clock does.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const inFlightRef = useRef(false);
  const viewRef = useRef<ScheduleView | null>(null);
  const scrolledRef = useRef(false);
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
      setNowMs(Date.now());
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

  // Land on the match that is on the field — once, so a 30s refresh never
  // yanks the list out from under a thumb.
  const readyMatches = view?.status === "ready" ? view.matches.length : 0;
  useEffect(() => {
    if (scrolledRef.current || readyMatches === 0) return;
    const target = document.getElementById("timeline-now");
    if (!target) return;
    scrolledRef.current = true;
    target.scrollIntoView({ block: "start", behavior: "auto" });
  }, [readyMatches]);

  if (!view) {
    return (
      <ScheduleShell
        title={fetchFailed ? "Could not load the match schedule" : "Loading match schedule…"}
        description={
          fetchFailed
            ? "A network or server issue blocked the board. Retry."
            : "Loading matches for your active event…"
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
  const viewerUserId = view.context.viewerUserId ?? null;
  const coordinator = view.context.role === "owner" || view.context.role === "admin";
  const teamKey = view.context.teamNumber != null ? `frc${view.context.teamNumber}` : null;
  const next = teamKey ? nextOurMatch(view.matches, teamKey) : null;
  const nextSide = next && teamKey ? allianceOf(next, teamKey) : null;
  const until = next ? matchesUntil(view.matches, next) : 0;
  const partners =
    next && nextSide && teamKey
      ? (nextSide === "red" ? next.red : next.blue).filter((key) => key !== teamKey).map(stripFrc)
      : [];
  const opponents = next && nextSide ? (nextSide === "red" ? next.blue : next.red).map(stripFrc) : [];
  const myNext = nextMyAssignment(view.matches, viewerUserId);
  const hasTimelineDetail = view.matches.some((match) => match.robots !== undefined);

  const groups = groupTimeline(view.matches, nowMs);
  const who = { teamKey, userId: viewerUserId };
  const keep = (match: ScheduleMatch) => matchPassesFilter(match, filter, who);
  const played = hidePlayed ? [] : groups.played.filter(keep);
  const upNext = groups.upNext.filter(keep);
  const later = groups.later.filter(keep);
  const visible = [...played, ...(groups.now ? [groups.now] : []), ...upNext, ...later];
  const shell: ScheduleShellKind = view.matches.length === 0 ? "empty" : "ready";
  const nextActions = scheduleNextActions({
    orgId,
    shell,
    hasActiveEvent: Boolean(view.context.eventKey),
    matchCount: view.matches.length,
  });
  const eventLabel = view.context.eventName ?? view.context.eventKey ?? "Active event";

  const row = (match: ScheduleMatch) => (
    <MatchRow
      key={match.matchKey}
      match={match}
      teamKey={teamKey}
      viewerUserId={viewerUserId}
      isNext={match.matchKey === next?.matchKey}
      isNow={match.matchKey === groups.now?.matchKey}
      orgId={orgId}
    />
  );

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
            <strong className="sched-hero-match">{labelOf(next)}</strong>
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

      {myNext ? (
        <section className="tl-mine-hero" aria-label="Your next scouting assignment">
          <div>
            <span className="sched-hero-kicker">You scout next</span>
            <strong>
              {labelOf(myNext.match)} · {stripFrc(myNext.robot.teamKey)}
            </strong>
            <span className="sched-hero-sub">
              {myNext.robot.alliance === "red" ? "Red" : "Blue"} {myNext.robot.station}
              {myNext.role === "backup" ? " · backup — scout it only if the primary cannot" : ""}
              {expectedClock(myNext.match) ? ` · ${expectedClock(myNext.match)}` : ""}
            </span>
          </div>
          <Button
            as="a"
            variant="primary"
            size="sm"
            href={withOrgHref(
              `/scouting?matchKey=${encodeURIComponent(myNext.match.matchKey)}&teamKey=${encodeURIComponent(myNext.robot.teamKey)}`,
              orgId,
            )}
          >
            Open the form
          </Button>
        </section>
      ) : null}

      {coordinator && hasTimelineDetail ? <MissedAlert matches={groups.played} orgId={orgId} /> : null}

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
              {(["all", "ours", "mine"] as const).map((option) => {
                const disabled = (option === "ours" && !teamKey) || (option === "mine" && !viewerUserId);
                return (
                  <button
                    key={option}
                    type="button"
                    className={filter === option ? "active" : undefined}
                    aria-pressed={filter === option}
                    disabled={disabled}
                    title={
                      option === "ours" && !teamKey
                        ? "Set a team number on Your team to filter"
                        : undefined
                    }
                    onClick={() => setFilter(option)}
                  >
                    {FILTER_LABELS[option]}
                  </button>
                );
              })}
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
              provenance={`${eventLabel} — ${FILTER_LABELS[filter].toLowerCase()}${
                hidePlayed ? ", unplayed only" : ""
              }. Event schedule from your team’s synced matches; entry counts are what your scouts submitted.`}
            />
          </div>

          {hasTimelineDetail ? (
            <p className="tl-legend">
              Each robot shows who is assigned and how many entries our scouts submitted. Scores are official (TBA);
              estimates come from event ratings.
            </p>
          ) : null}

          {visible.length === 0 ? (
            <EmptyState
              soft
              title="Nothing matches your filters"
              description={
                filter === "mine"
                  ? "You have no scouting assignments at this event. Ask your scouting lead, or scout any robot from the Scouting page."
                  : "Try showing played matches or switching back to all matches."
              }
            />
          ) : (
            <>
              <TimelineSection id="played" title="Played" matches={played}>
                {row}
              </TimelineSection>
              {groups.now ? (
                <TimelineSection
                  id="now"
                  title="On field now"
                  hint={keep(groups.now) ? undefined : "shown with every filter"}
                  matches={[groups.now]}
                >
                  {row}
                </TimelineSection>
              ) : null}
              <TimelineSection id="next" title="Up next" matches={upNext}>
                {row}
              </TimelineSection>
              <TimelineSection id="later" title="Later" matches={later}>
                {row}
              </TimelineSection>
            </>
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

function expectedClock(match: ScheduleMatch): string {
  return clock(match.predictedTime ?? match.plannedTime ?? match.scheduledTime);
}
