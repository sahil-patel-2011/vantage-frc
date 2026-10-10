"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import {
  Badge,
  type BadgeTone,
  EmptyState,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
  Button,
} from "../../components/ui";
import { MAX_REPORT_TARGET, REVIEWED_FLAG_HISTORY_LIMIT, type CoverageStatus } from "../../lib/scout-coverage-live/types";
import type { ReviewCommand } from "../../lib/scout-coverage-live/request";
import { useReviewData } from "./use-review-data";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import type { ScoutCoverageLiveView } from "../../lib/scout-coverage-live/compute-scout-coverage-live";
import {
  SCOUT_COVERAGE_LIVE_RELATED_INCLUDE,
  classifyScoutCoverageLiveShell,
  formatScoutCoverageLiveMetric,
  formatScoutCoverageLiveRate,
  scoutCoverageLiveRelatedLinks,
  scoutCoverageLiveSetupSteps,
  scoutCoverageLiveShellCopy,
  shouldShowScoutCoverageLiveSummaryTiles,
  type ScoutCoverageLiveShellKind,
} from "../../lib/scout-coverage-live/scout-coverage-live-related";
import { hubHref } from "../../lib/nav/hubs";
import { scoutEventLabel } from "../../lib/scouting/scouting-related";
import { withOrgHref } from "../../lib/nav/product-nav";
import { summarizeMissed } from "../../lib/scouting/assignment-accountability";
import "./scout-coverage-live.css";
import "../scouting/lineup/lineup.css";
import { assignmentWorkspaceHref } from "../../lib/scouting/assignment-navigation";

function CoverageWorkspaceViews({ orgId, assignmentHref, eventKey }: { orgId?: string | null; assignmentHref?: string; eventKey?: string }) {
  const base = assignmentHref ?? assignmentWorkspaceHref({ orgId: orgId ?? undefined });
  const [path, query] = base.split("?");
  const params = new URLSearchParams(query);
  if (eventKey) params.set("eventKey", eventKey);
  const href = params.size ? `${path}?${params}` : base;
  return <nav className="lineup-workspace-views" aria-label="Assignment workspace views">
    <a href={href}>Assignments</a>
    <a aria-current="page" href={`${href}${href.includes("?") ? "&" : "?"}view=review`}>Coverage review</a>
  </nav>;
}

const statusToneMap: Record<CoverageStatus, BadgeTone> = {
  zero: "danger",
  thin: "setup",
  covered: "good",
};

function statusTone(status: CoverageStatus): BadgeTone {
  return statusToneMap[status] ?? "neutral";
}

function statusLabel(status: CoverageStatus, played?: boolean): string {
  if (played === false) return "Upcoming · no scout";
  if (status === "zero") return played ? "Played · never scouted" : "Not scouted";
  if (status === "thin") return "Needs another scout";
  return "Scouted";
}

type LiveView = Extract<ScoutCoverageLiveView, { status: "live" }>;

function ScoutCoverageLiveRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = scoutCoverageLiveRelatedLinks(orgId, {
    include: [...SCOUT_COVERAGE_LIVE_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related scout-coverage-live-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.href} href={link.href}>{link.label}</a>
      ))}
    </nav>
  );
}

function ScoutCoverageLiveShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  errorStatus,
  emptyTitle,
  emptyDescription,
  action,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: ScoutCoverageLiveShellKind;
  error?: string;
  onRetry?: () => void;
  errorStatus?: number | null;
  emptyTitle?: string;
  emptyDescription?: string;
  action?: { href: string; label: string } | null;
  children?: ReactNode;
}) {
  const copy = scoutCoverageLiveShellCopy(shell);
  const competitionHref = hubHref("/competition", "scouting", orgId);
  const setup = shell === "setup" ? scoutCoverageLiveSetupSteps(orgId)[0] : null;
  const commandHref = hubHref("/competition", "command", orgId);

  const failure = shell === "error" ? loadFailureCopy(classifyLoadFailure({ status: errorStatus, message: error, online: typeof navigator === "undefined" ? true : navigator.onLine }), { message: error, nextPath: typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}` }) : null;
  return (
    <main className="module-page scout-coverage-live-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Coverage review"}
          </>
        }
        title="Coverage review"
        description={description}
      >
        <ScoutCoverageLiveRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading scout coverage live">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <EmptyState badge={failure?.badge} title={failure?.title ?? copy.title} description={failure?.description ?? error ?? copy.description}>
          {failure?.primary ? <Button as="a" variant="primary" href={failure.primary.href}>{failure.primary.label}</Button> : null}
          {failure?.showRetry && onRetry ? <Button variant="secondary" type="button" onClick={onRetry}>Refresh</Button> : null}
        </EmptyState>
      ) : (
        <EmptyState
          soft
          badge={
            shell === "setup"
              ? "Needs setup"
              : shell === "empty"
                ? "No schedule yet"
                : copy.badge
          }
          badgeTone="setup"
          title={emptyTitle ?? copy.title}
          description={emptyDescription ?? error ?? copy.description}
        >
          {action ? (
            <Button as="a" variant="primary" href={action.href}>
              {action.label}
            </Button>
          ) : setup ? (
            <Button as="a" variant="primary" href={setup.href}>
              {setup.label}
            </Button>
          ) : null}
          {shell === "empty" ? (
            <Button as="a" variant="primary" href={commandHref}>Sync event schedule</Button>
          ) : null}
        </EmptyState>
      )}
    </main>
  );
}

export default function ScoutCoverageLiveClient({ orgId, eventKey, assignmentHref }: { orgId: string; eventKey?: string; assignmentHref?: string }) {
  const { view, error, notice, fetchFailed, failureStatus, busy, refreshing, fromCache, cachedAt, load, mutate } = useReviewData(orgId, eventKey);
  const [thresholdInput, setThresholdInput] = useState("");
  const editedTarget = useRef(false);
  useEffect(() => {
    if (view?.status === "live" && !editedTarget.current) setThresholdInput(String(view.thinThreshold));
  }, [view]);
  const controlsDisabled = busy || refreshing || fromCache;
  const target = Number(thresholdInput);
  const targetValid = Number.isInteger(target) && target >= 1 && target <= MAX_REPORT_TARGET;

  const totalCells = view?.status === "live" ? view.cells.length : 0;

  const shell = classifyScoutCoverageLiveShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    totalCells,
  });
  const shellCopy = scoutCoverageLiveShellCopy(shell);
  const competitionHref = hubHref("/competition", "scouting", orgId);
  const showTiles =
    view?.status === "live" &&
    shouldShowScoutCoverageLiveSummaryTiles({ totalCells: view.cells.length });
  const loaded = view?.status === "live";

  if (shell === "loading") {
    return (
      <ScoutCoverageLiveShell description={shellCopy.description} orgId={orgId} shell="loading">
        <CoverageWorkspaceViews orgId={orgId} assignmentHref={assignmentHref} /><OfflineBanner feature="Coverage review" fromCache={fromCache} cachedAt={cachedAt} />
      </ScoutCoverageLiveShell>
    );
  }
  if (shell === "error") {
    return (
      <ScoutCoverageLiveShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        errorStatus={failureStatus}
        onRetry={() => void load()}
      >
        <CoverageWorkspaceViews orgId={orgId} assignmentHref={assignmentHref} /><OfflineBanner feature="Coverage review" fromCache={fromCache} cachedAt={cachedAt} />
      </ScoutCoverageLiveShell>
    );
  }
  if (shell === "setup") {
    const step = view?.status === "setup_required" ? view.steps[0] : null;
    const hasTeam = Boolean(view?.orgId ?? orgId);
    return (
      <ScoutCoverageLiveShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        emptyTitle={hasTeam && view?.status === "setup_required" ? view.message : undefined}
        emptyDescription={hasTeam && step ? step.detail : undefined}
        action={step ? { href: step.href, label: step.label } : undefined}
        orgId={orgId}
        shell="setup"
      >
        <CoverageWorkspaceViews orgId={orgId} assignmentHref={assignmentHref} /><OfflineBanner feature="Coverage review" fromCache={fromCache} cachedAt={cachedAt} />
      </ScoutCoverageLiveShell>
    );
  }
  if (shell === "empty" || view?.status !== "live") {
    return (
      <ScoutCoverageLiveShell description={shellCopy.description} orgId={orgId} shell="empty">
        <CoverageWorkspaceViews orgId={orgId} assignmentHref={assignmentHref} /><OfflineBanner feature="Coverage review" fromCache={fromCache} cachedAt={cachedAt} />
      </ScoutCoverageLiveShell>
    );
  }

  return (
    <main className="module-page scout-coverage-live-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Coverage review"}
          </>
        }
        title="Coverage review"
        description="Which robots were never scouted in played matches, which upcoming robots have no scout yet, and shared flags for a scouting lead to review."
      >
        <div className="scout-coverage-live-header-meta">
          <ScoutCoverageLiveRelatedStrip orgId={orgId} />
          <Button variant="secondary" type="button" disabled={busy || refreshing} onClick={() => void load()}>{refreshing ? "Refreshing…" : "Refresh"}</Button>
        </div>
      </PageHeader>

      <CoverageWorkspaceViews orgId={orgId} assignmentHref={assignmentHref} eventKey={view.eventKey} /><OfflineBanner feature="Coverage review" fromCache={fromCache} cachedAt={cachedAt} />

      {fromCache ? <p className="app-muted">This copy is read-only. Refresh before changing flags or the report target.</p> : null}
      {notice ? <p className="scout-review-notice" role="status">{notice}</p> : null}
      {error ? (
        <p className="form-message" role="status">
          {error}
        </p>
      ) : null}

      <section className="scout-coverage-live-event" aria-label="Event and report target">
        <div>
          <span className="app-muted">Event</span>
          <strong style={{ display: "block" }}>
            {scoutEventLabel({ eventName: view.eventName, eventKey: view.eventKey }) ?? "Your event"}
          </strong>
        </div>
        <p className="app-muted">Saved report target: {view.thinThreshold} per robot per match</p>
        {view.canManage ? (
          <details className="scout-review-target">
            <summary>Report target</summary>
            <form onSubmit={event => {
              event.preventDefault();
              if (!targetValid || controlsDisabled || target === view.thinThreshold) return;
              void mutate({ action: "set-threshold", thinThreshold: target, expectedThreshold: view.thinThreshold }).then(saved => {
                if (saved) { editedTarget.current = false; setThresholdInput(String(target)); }
              });
            }}>
              <FormRow label="Reports wanted per robot" hint="One report covers a robot. Extra reports can check consistency.">
                <input type="number" min={1} max={MAX_REPORT_TARGET} step={1} aria-invalid={!targetValid} disabled={controlsDisabled} value={thresholdInput} onChange={event => { editedTarget.current = true; setThresholdInput(event.target.value); }} />
              </FormRow>
              {!targetValid ? <p className="app-muted">Choose a whole number from 1 to {MAX_REPORT_TARGET}.</p> : null}
              <Button variant="secondary" type="submit" disabled={controlsDisabled || !targetValid || target === view.thinThreshold}>{busy ? "Saving…" : "Save report target"}</Button>
            </form>
          </details>
        ) : null}
      </section>

      {showTiles ? <SummaryTiles view={view} loaded={loaded} /> : null}
      <CoverageGaps key={`gaps:${view.orgId}:${view.eventKey}`} view={view} busy={controlsDisabled} mutate={mutate} loaded={loaded} />
      <MissedAssignments key={`missed:${view.orgId}:${view.eventKey}`} view={view} orgId={orgId} />
      <NudgeLog key={`flags:${view.orgId}:${view.eventKey}`} view={view} busy={controlsDisabled} mutate={mutate} />
    </main>
  );
}

function SummaryTiles({ view, loaded }: { view: LiveView; loaded: boolean }) {
  const { summary, scope } = view;
  const hasSchedule = summary.totalCells > 0;
  // Every tile names its scope: played matches (what was actually scouted)
  // or upcoming matches (what a lead can still fix).
  return (
    <section className="scout-coverage-live-kpis" aria-label="Coverage summary">
      <StatTile
        label="Played robots: report target met"
        value={formatScoutCoverageLiveRate(summary.coveragePct, loaded, { hasSchedule })}
        unit={`${formatScoutCoverageLiveMetric(summary.coveredCount, loaded)} of ${formatScoutCoverageLiveMetric(summary.totalCells, loaded)} robots`}
      />
      <StatTile
        label="Played matches: never scouted"
        value={formatScoutCoverageLiveMetric(summary.zeroCount, loaded)}
        unit={summary.zeroCount === 1 ? "robot" : "robots"}
      />
      {view.thinThreshold > 1 ? (
        <StatTile
          label={`Reported: below ${view.thinThreshold}-report target`}
          value={formatScoutCoverageLiveMetric(summary.thinCount, loaded)}
          unit={summary.thinCount === 1 ? "robot" : "robots"}
        />
      ) : null}
      {scope ? (
        <StatTile
          label="Upcoming: no scout assigned"
          value={formatScoutCoverageLiveMetric(scope.upcomingNoScout, loaded)}
          unit={`of ${formatScoutCoverageLiveMetric(scope.upcomingRobots, loaded)} robots in ${formatScoutCoverageLiveMetric(scope.upcomingMatches, loaded)} matches`}
        />
      ) : null}
    </section>
  );
}

function CoverageGaps({
  view,
  busy,
  mutate,
  loaded,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: ReviewCommand) => Promise<boolean>;
  loaded: boolean;
}) {
  const [visible, setVisible] = useState(15);
  return (
    <Panel className="scout-coverage-live-panel" id="coverage-gaps">
      <header>
        <h2>Robots to cover</h2>
        <p className="app-muted">
          Upcoming robots with no scout come first, then played robots nobody scouted (newest first, so the video
          is easy to find).
        </p>
      </header>
      {view.gaps.length === 0 ? (
        <p className="app-muted">
          No gaps in this review. Upcoming robots are assigned and played robots meet the saved report target.
        </p>
      ) : (
        <ul className="scout-coverage-live-list">
          {view.gaps.slice(0, visible).map((cell) => (
            <li key={`${cell.matchKey}::${cell.teamKey}`}>
              <div>
                <div className="scout-coverage-live-row-meta">
                  <Badge tone={cell.played === false ? "setup" : statusTone(cell.status)}>
                    {statusLabel(cell.status, cell.played)}
                  </Badge>
                  <strong>
                    {cell.matchLabel} · Team {cell.teamNumber}
                  </strong>
                </div>
                <small>
                  {cell.alliance === "red" ? "Red" : "Blue"} alliance ·{" "}
                  {cell.entryCount === 0
                    ? "no reports"
                    : `${formatScoutCoverageLiveMetric(cell.entryCount, loaded)} ${cell.entryCount === 1 ? "report" : "reports"}`}
                </small>
              </div>
              <Button
                variant="secondary"
                type="button"
                aria-label={`Flag for the coordinator: ${cell.matchLabel}, Team ${cell.teamNumber}`}
                disabled={busy || view.nudges.some(nudge => !nudge.acknowledged && nudge.matchKey === cell.matchKey && nudge.teamKey === cell.teamKey)}
                onClick={() => void mutate({ action: "send-nudge", matchKey: cell.matchKey, teamKey: cell.teamKey, message:
                      cell.played === false
                        ? `${cell.matchLabel}: Team ${cell.teamNumber} has no scout yet. Please assign one.`
                        : cell.entryCount === 0 ? `${cell.matchLabel}: Team ${cell.teamNumber} has no report. Can someone scout it from the video?` : `${cell.matchLabel}: Team ${cell.teamNumber} has ${cell.entryCount} of ${view.thinThreshold} wanted reports. Please review whether another observation is available.`, }) }
              >
                {view.nudges.some(nudge => !nudge.acknowledged && nudge.matchKey === cell.matchKey && nudge.teamKey === cell.teamKey) ? "Flag pending" : "Flag for review"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ReviewListFooter visible={visible} total={view.gaps.length} label="robots to cover" onMore={() => setVisible(count => count + 15)} />
    </Panel>
  );
}

/**
 * Assigned but not submitted. Coverage counts entries per robot; this names the
 * person whose robot it was, while the match is fresh enough to ask them — or
 * to pull the video.
 */
function MissedAssignments({ view, orgId }: { view: LiveView; orgId: string | null | undefined }) {
  const [lostVisible, setLostVisible] = useState(30);
  const [coveredVisible, setCoveredVisible] = useState(30);
  const missed = view.missed;
  if (!missed) return null;
  const summary = summarizeMissed(missed);
  // Robots nobody scouted come first: those are the gaps. A missed shift where
  // someone else scouted the robot is a talk with the scout, not lost data.
  const newestFirst = [...missed].reverse();
  const lost = newestFirst.filter((row) => !row.robotScouted);
  const covered = newestFirst.filter((row) => row.robotScouted);
  const unscoutedRobots = new Set(lost.map(row => `${row.matchKey}::${row.teamKey}`)).size;
  const renderRow = (row: (typeof missed)[number]) => (
    <li key={`${row.matchKey}::${row.teamKey}::${row.userId}`}>
      <div>
        <div className="scout-coverage-live-row-meta">
          <Badge tone={row.robotScouted ? "setup" : "danger"}>
            {row.robotScouted ? "Someone else scouted it" : "Nobody scouted it"}
          </Badge>
          <strong>
            {row.matchLabel} · Team {row.teamKey.replace(/^frc/i, "")}
          </strong>
        </div>
        <small>
          {row.name}
          {row.role === "backup" ? " (backup)" : ""}
        </small>
      </div>
    </li>
  );
  return (
    <Panel className="scout-coverage-live-panel" id="missed-assignments">
      <header>
        <h2>Assigned, but no report</h2>
        <p className="app-muted">
          Played matches where the assigned scout sent no report for their robot. A backup is listed only when the
          main scout missed too.
        </p>
      </header>
      {missed.length === 0 ? (
        <p className="app-muted">Every assigned scout in a played match sent a report.</p>
      ) : (
        <>
          <p className="app-muted">
            {summary.total} missed assignments · {unscoutedRobots} {unscoutedRobots === 1 ? "robot" : "robots"} nobody scouted
            {summary.byScout.length
              ? ` · most: ${summary.byScout
                  .slice(0, 3)
                  .map((row) => `${row.name} (${row.count})`)
                  .join(", ")}`
              : ""}
          </p>
          {lost.length ? <ul className="scout-coverage-live-list">{lost.slice(0, lostVisible).map(renderRow)}</ul> : null}
          <ReviewListFooter visible={lostVisible} total={lost.length} label="missed assignments without a report" onMore={() => setLostVisible(count => count + 30)} />
          {covered.length ? (
            <details>
              <summary data-disclosure>
                {covered.length} more where someone else scouted the robot
              </summary>
              <ul className="scout-coverage-live-list">{covered.slice(0, coveredVisible).map(renderRow)}</ul>
              <ReviewListFooter visible={coveredVisible} total={covered.length} label="missed assignments covered by another scout" onMore={() => setCoveredVisible(count => count + 30)} />
            </details>
          ) : null}
          <p className="app-muted">
            <a href={withOrgHref("/schedule", orgId ?? null)}>See them on the match timeline</a>
          </p>
        </>
      )}
    </Panel>
  );
}

function NudgeLog({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: ReviewCommand) => Promise<boolean>;
}) {
  const [visible, setVisible] = useState(30);
  return (
    <Panel className="scout-coverage-live-panel" id="nudge-log">
      <header>
        <h2>Shared coverage flags</h2>
        <p className="app-muted">All outstanding flags and the latest {REVIEWED_FLAG_HISTORY_LIMIT} reviewed flags, visible to your team. A scouting lead marks each flag reviewed here.</p>
      </header>
      {view.nudges.length === 0 ? (
        <p className="app-muted">No flags yet. Flag a gap above when it needs a scouting lead’s attention.</p>
      ) : (
        <ul className="scout-coverage-live-list">
          {view.nudges.slice(0, visible).map((nudge) => (
            <li key={nudge.id}>
              <div>
                <strong>
                  {nudge.matchLabel} · Team {nudge.teamNumber}
                </strong>
                <small>{nudge.message}</small>
                <small>
                  Flagged {new Date(nudge.sentAt).toLocaleString()}
                  {nudge.acknowledged ? " · Reviewed" : ""}
                </small>
              </div>
              {view.canManage && !nudge.acknowledged ? (
                <Button variant="secondary" type="button" disabled={busy} aria-label={`Mark reviewed: ${nudge.matchLabel}, Team ${nudge.teamNumber}`} onClick={() => void mutate({ action: "acknowledge-nudge", nudgeId: nudge.id })}>
                  Mark reviewed
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ReviewListFooter visible={visible} total={view.nudges.length} label="coverage flags" onMore={() => setVisible(count => count + 30)} />
    </Panel>
  );
}

function ReviewListFooter({ visible, total, label, onMore }: { visible: number; total: number; label: string; onMore: () => void }) {
  if (total === 0) return null;
  return <div className="scout-review-list-footer">
    <p className="app-muted" role="status">Showing {Math.min(visible, total)} of {total} {label}</p>
    {visible < total ? <Button type="button" variant="secondary" aria-label={`Show more ${label}`} onClick={onMore}>Show more</Button> : null}
  </div>;
}
