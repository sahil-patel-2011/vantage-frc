"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { EmptyState, PageHeader, Button } from "../../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import { CopyShareLink } from "../../../components/copy-share-link";
import type { CoverageGapSlot } from "@vantage/scouting/coverage";
import {
  LINEUP_POLL_MS,
  LINEUP_RELATED_INCLUDE,
  classifyLineupShell,
  formatLineupMetric,
  lineupEmptyDescription,
  lineupNextActions,
  lineupRelatedLinks,
  lineupScoutNowHref,
  lineupSetupSteps,
  lineupShellCopy,
  shouldPollLineup,
  shouldShowLineupSummaryTiles,
  type LineupShellKind,
} from "../../../lib/scouting/lineup-related";
import { hubHref } from "../../../lib/nav/hubs";
import { matchLabelFromKey } from "../../../lib/matches/no-next-match";
import { scoutEventLabel } from "../../../lib/scouting/scouting-related";
import { AssignmentRangeForm } from "./assignment-range-form";
import { useCoverageData } from "./use-coverage-data";
import { assignmentWorkspaceHref } from "../../../lib/scouting/assignment-navigation";
import "./lineup.css";

function teamLabel(slot: CoverageGapSlot): string {
  return slot.teamNumber != null ? String(slot.teamNumber) : slot.teamKey.replace(/^frc/i, "");
}

function statusLabel(status: CoverageGapSlot["status"]): string {
  if (status === "double") return "Scouted twice";
  if (status === "unscouted") return "No scout";
  if (status === "assigned") return "Scout assigned";
  return "Scouted";
}

function slotMatchLabel(slot: Pick<CoverageGapSlot, "matchKey">): string {
  return matchLabelFromKey(slot.matchKey);
}

function LineupRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = lineupRelatedLinks(orgId, {
    include: [...LINEUP_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related lineup-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.href} href={link.href}>{link.label}</a>
      ))}
    </nav>
  );
}

function LineupShell({
  description,
  orgId,
  shell,
  error,
  errorStatus,
  onRetry,
  canAssign,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: LineupShellKind;
  error?: string;
  /** HTTP status of the failed load, so an expired session can offer sign-in. */
  errorStatus?: number | null;
  onRetry?: () => void;
  canAssign?: boolean;
  children?: ReactNode;
}) {
  const actions = lineupNextActions({ orgId, shell, canAssign });
  const copy = lineupShellCopy(shell);
  const competitionHref = hubHref("/competition", "scouting", orgId);
  const setup = shell === "setup" ? lineupSetupSteps(orgId)[0] : null;
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
  return (
    <main className="module-page lineup-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Assignments"}
          </>
        }
        title="Assignments"
        description={description}
      >
        <LineupRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          failure ? failure.badge : shell === "setup"
            ? "Needs setup"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No schedule yet"
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
        {!failure?.primary && setup ? (
          <Button as="a" variant="primary" href={setup.href}>
            {setup.label}
          </Button>
        ) : null}
        {shell === "empty" && actions[0] ? (
          <Button as="a" variant="primary" href={actions[0].href}>
            {actions[0].label}
          </Button>
        ) : null}
      </EmptyState>
    </main>
  );
}

export default function LineupClient({ orgId, eventKey, initialMatchKey = "", initialQualsOnly = true }: { orgId: string; eventKey?: string; initialMatchKey?: string; initialQualsOnly?: boolean }) {
  const [qualsOnly, setQualsOnly] = useState(initialQualsOnly);
  const [focusMatch, setFocusMatch] = useState(initialMatchKey);
  const [liveUpdates, setLiveUpdates] = useState(false);
  const { view, error, notice, fetchFailed, failureStatus, busy, fromCache, cachedAt, refreshing, load, mutate } = useCoverageData(orgId, eventKey, qualsOnly, focusMatch);
  const controlsDisabled = busy || refreshing || fromCache;
  const updatedAt = view?.generatedAt ?? "";
  useEffect(() => {
    if (!liveUpdates) return;
    const timer = window.setInterval(() => {
      if (shouldPollLineup(document.visibilityState)) void load();
    }, LINEUP_POLL_MS);
    return () => window.clearInterval(timer);
  }, [liveUpdates, load]);

  const matchOptions = useMemo(() => {
    if (!view || view.status !== "live") return [];
    const seen = new Set<string>();
    const options: Array<{ matchKey: string; label: string }> = [];
    for (const slot of view.slots) {
      if (seen.has(slot.matchKey)) continue;
      seen.add(slot.matchKey);
      options.push({
        matchKey: slot.matchKey,
        label: slotMatchLabel(slot),
      });
    }
    return options;
  }, [view]);

  const grouped = useMemo(() => {
    if (!view || view.status !== "live") return [];
    const byMatch = new Map<string, CoverageGapSlot[]>();
    for (const slot of view.live.focusSlots) {
      const list = byMatch.get(slot.matchKey) ?? [];
      list.push(slot);
      byMatch.set(slot.matchKey, list);
    }
    return view.live.focusMatchKeys.map((key) => ({
      matchKey: key,
      slots: byMatch.get(key) ?? [],
    }));
  }, [view]);

  const totalSlots = view?.status === "live" ? view.summary.totalSlots : 0;

  const shell = classifyLineupShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    totalSlots,
  });
  const shellCopy = lineupShellCopy(shell);
  const competitionHref = hubHref("/competition", "scouting", orgId);
  const showTiles = view?.status === "live" && shouldShowLineupSummaryTiles(totalSlots);
  const loaded = view?.status === "live";

  if (shell === "loading") {
    return (
      <LineupShell description={shellCopy.description} orgId={orgId} shell="loading">
        <OfflineBanner feature="Assignments" fromCache={fromCache} cachedAt={cachedAt} />
      </LineupShell>
    );
  }

  if (shell === "error") {
    return (
      <LineupShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        errorStatus={failureStatus}
        onRetry={() => void load()}
      >
        <OfflineBanner feature="Assignments" fromCache={fromCache} cachedAt={cachedAt} />
      </LineupShell>
    );
  }

  if (shell === "setup") {
    return (
      <LineupShell
        description={
          view?.status === "setup_required" ? view.message : shellCopy.description
        }
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Assignments" fromCache={fromCache} cachedAt={cachedAt} />
      </LineupShell>
    );
  }

  if (shell === "empty" || view?.status !== "live") {
    const canAssign = view?.status === "live" ? view.canAssign : false;
    const description =
      view?.status === "live"
        ? lineupEmptyDescription({
            eventName: view.eventName,
            eventKey: view.eventKey,
            canAssign,
          })
        : shellCopy.description;
    return (
      <LineupShell description={description} orgId={orgId} shell="empty" canAssign={canAssign}>
        <OfflineBanner feature="Assignments" fromCache={fromCache} cachedAt={cachedAt} />
      </LineupShell>
    );
  }

  return (
    <main className="module-page lineup-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Assignments"}
          </>
        }
        title="Assignments"
        description="Assign one robot per scout, follow the next matches and see which reports still need collecting."
      >
        <div className="lineup-header-meta">
          <span className="lineup-live-pill" data-state={fromCache ? "cached" : refreshing ? "refreshing" : "current"} aria-live="polite">
            {fromCache ? "Device copy" : refreshing ? "Refreshing…" : "Updated"}
            {updatedAt ? ` · ${new Date(updatedAt).toLocaleTimeString()}` : ""}
          </span>
          <LineupRelatedStrip orgId={orgId} />
          <Button variant="secondary" type="button" disabled={busy || refreshing} onClick={() => void load()}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
          <CopyShareLink orgId={orgId} pathWithSearch={assignmentWorkspaceHref({ orgId, eventKey: view.eventKey, matchKey: view.live.focusMatchKeys[0], qualsOnly: view.qualsOnly })} />
          {view.canAssign ? (
            <Button variant="primary" type="button" disabled={controlsDisabled || !view.slots.some(slot => slot.status === "unscouted" && !view.playedMatchKeys.includes(slot.matchKey))} onClick={() => void mutate({ action: "auto-assign" })}>
              {busy ? "Saving…" : "Assign available scouts"}
            </Button>
          ) : null}
          <Button variant="secondary" type="button" onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </PageHeader>

      <nav className="lineup-workspace-views" aria-label="Assignment workspace views">
        <a aria-current="page" href={assignmentWorkspaceHref({ orgId, eventKey: view.eventKey, matchKey: view.live.focusMatchKeys[0], qualsOnly: view.qualsOnly })}>Assignments</a>
        <a href={assignmentWorkspaceHref({ orgId, eventKey: view.eventKey, matchKey: view.live.focusMatchKeys[0], qualsOnly: view.qualsOnly, view: "review" })}>Coverage review</a>
      </nav>
      <OfflineBanner feature="Assignments" fromCache={fromCache} cachedAt={cachedAt} />
      {fromCache ? <p className="app-muted">This copy is read-only. Refresh to check current assignments and permissions before making changes.</p> : null}

      {view.qualsOnly !== qualsOnly ? <p className="lineup-notice" role="status">Showing {view.qualsOnly ? "qualification matches" : "all matches"} until the selected filter finishes loading. Assignment changes are paused.</p> : null}
      {notice ? <p className="lineup-notice" role="status">{notice}</p> : null}
      {error ? (
        <p className="form-message" role="status">
          {error}
        </p>
      ) : null}

      <section className="lineup-controls" aria-label="Coverage filters">
        <label>
          Focus match
          <select value={matchOptions.some(option => option.matchKey === focusMatch) ? focusMatch : view.live.focusMatchKeys[0] || ""} disabled={busy} onChange={(event) => setFocusMatch(event.target.value)}>
            {matchOptions.map((option) => (
              <option key={option.matchKey} value={option.matchKey}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="lineup-check">
          <input
            type="checkbox"
            disabled={busy}
            checked={qualsOnly}
            onChange={(event) => { setQualsOnly(event.target.checked); setFocusMatch(""); }}
          />
          Quals only
        </label>
        <label className="lineup-check">
          <input type="checkbox" checked={liveUpdates} disabled={busy} onChange={event => setLiveUpdates(event.target.checked)} />
          Refresh every minute
        </label>
        <span className="app-muted">
          {scoutEventLabel({ eventName: view.eventName, eventKey: view.eventKey }) ?? "Your event"}
        </span>
      </section>

      {view.canAssign ? (
        <details className="lineup-disclosure">
          <summary>Assign a robot across several matches</summary>
          <AssignmentRangeForm key={`${view.orgId}:${view.eventKey}`} matchKeys={view.slots} scouts={view.scouts} qualsOnly={qualsOnly} busy={controlsDisabled} onAssign={payload => void mutate(payload)} />
        </details>
      ) : null}

      {view.schemaRoles.warnings.length ? (
        <details className="lineup-disclosure">
          <summary>Form mapping · {view.schemaRoles.warnings.length} items to review</summary>
          <p className="app-muted">Unmapped observations stay missing in analysis.</p>
          <ul className="lineup-setup-steps">
            {view.schemaRoles.warnings.map(warning => <li key={warning.id}><p>{warning.message}</p></li>)}
          </ul>
          <Button as="a" variant="secondary" href={hubHref("/competition", "forms", orgId)}>Review form mapping</Button>
        </details>
      ) : null}

      {showTiles ? (
        <section className="lineup-kpis" aria-label="Coverage summary">
          {view.scope ? (
            <>
              <article>
                <span>Upcoming: no scout</span>
                <strong>{formatLineupMetric(view.scope.upcomingNoScout, loaded)}</strong>
                <small>
                  of {formatLineupMetric(view.scope.upcomingRobots, loaded)} robots in{" "}
                  {formatLineupMetric(view.scope.upcomingMatches, loaded)} matches
                </small>
              </article>
              <article>
                <span>Played: scouted</span>
                <strong>
                  {formatLineupMetric(view.scope.playedScouted, loaded)} of{" "}
                  {formatLineupMetric(view.scope.playedRobots, loaded)}
                </strong>
                <small>robots in {formatLineupMetric(view.scope.playedMatches, loaded)} played matches</small>
              </article>
              <article>
                <span>Played: never scouted</span>
                <strong>{formatLineupMetric(view.scope.playedMissed, loaded)}</strong>
                <small>robots, too late to watch live</small>
              </article>
            </>
          ) : (
            <article>
              <span>No scout</span>
              <strong>{formatLineupMetric(view.summary.unscouted, loaded)}</strong>
              <small>robots with no report or scout</small>
            </article>
          )}
          <article>
            <span>Scouted twice</span>
            <strong>{formatLineupMetric(view.summary.doubleCovered, loaded)}</strong>
            <small>robots with two or more reports</small>
          </article>
        </section>
      ) : null}

      <section className="lineup-board-wrap">
        <header>
          <h2>Match assignments</h2>
          <p className="app-muted">Four matches from your selection. Assignments and completed reports are shown separately.</p>
        </header>
        {grouped.map((group) => {
          const sample = group.slots[0];
          return (
            <div key={group.matchKey} className="lineup-match">
              <h3>
                {sample ? slotMatchLabel(sample) : matchLabelFromKey(group.matchKey)}
              </h3>
              <div className="lineup-board">
                {group.slots.map((slot) => (
                  <article key={`${slot.matchKey}-${slot.teamKey}`} className={slot.status}>
                    <b>{slot.alliance ?? "—"}</b>
                    <span>{teamLabel(slot)}</span>
                    <small>{statusLabel(slot.status)}</small>
                    {slot.assignedScouts?.length ? (
                      <ul className="lineup-scouts">
                        {slot.assignedScouts.map(scout => (
                          <li key={scout.userId}>
                            <span>{scout.name}{scout.role === "backup" ? " · backup" : ""}</span>
                            {view.canAssign ? (
                              <label>Reassign {scout.name}
                                <select value={scout.userId} disabled={controlsDisabled} onChange={event => void mutate({ action: "swap", matchKey: slot.matchKey, teamKey: slot.teamKey, fromUserId: scout.userId, toUserId: event.target.value })}>
                                  {!view.scouts.some(member => member.userId === scout.userId) ? <option value={scout.userId}>{scout.name} · no longer a member</option> : null}
                                  {view.scouts.filter(member => member.userId === scout.userId || !slot.assignedScouts?.some(assigned => assigned.userId === member.userId)).map(member => <option key={member.userId} value={member.userId}>{member.name}{member.isMe ? " (me)" : ""}</option>)}
                                </select>
                              </label>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : slot.assignmentCount ? <p className="app-muted">Assignment details unavailable. Refresh to view scouts.</p> : view.canAssign ? (
                      <label className="lineup-assign">Assign a scout
                        <select value="" disabled={controlsDisabled} onChange={event => { if (event.target.value) void mutate({ action: "assign", matchKey: slot.matchKey, teamKey: slot.teamKey, userId: event.target.value }); }}>
                          <option value="">Choose a scout…</option>
                          {view.scouts.map(scout => <option key={scout.userId} value={scout.userId}>{scout.name}{scout.isMe ? " (me)" : ""} · {scout.assignedCount}</option>)}
                        </select>
                      </label>
                    ) : <p className="app-muted">No scout assigned</p>}
                    {slot.entryCount > 0 ? <p className="app-muted">{slot.entryCount} {slot.entryCount === 1 ? "report" : "reports"}{slot.scoutNames?.length ? ` · ${slot.scoutNames.join(", ")}` : ""}</p> : null}
                    <a className="lineup-scout-link" href={lineupScoutNowHref(orgId, slot.matchKey, slot.teamKey)}>{slot.entryCount ? "Open scouting" : "Scout this robot"}</a>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
        {!grouped.length ? (
          <p className="app-muted">
            {view.canAssign
              ? "No match schedule yet. Update the event data once the schedule is out."
              : "No match schedule yet. An owner or admin updates the event data once it is out."}
          </p>
        ) : null}
      </section>

    </main>
  );
}
