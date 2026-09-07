"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, PageHeader, Panel } from "../../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import { CopyShareLink } from "../../../components/copy-share-link";
import type { CoverageGapSlot, CoverageGapSummary } from "@vantage/scouting/coverage";
import {
  LINEUP_POLL_MS,
  LINEUP_RELATED_INCLUDE,
  classifyLineupShell,
  formatLineupCoverage,
  formatLineupMetric,
  lineupNextActions,
  lineupRelatedLinks,
  lineupScoutNowHref,
  lineupSetupSteps,
  lineupShellCopy,
  shouldPollLineup,
  shouldShowLineupSummaryTiles,
  type LineupNextAction,
  type LineupShellKind,
} from "../../../lib/scouting/lineup-related";
import { hubHref } from "../../../lib/nav/hubs";
import { withOrgHref } from "../../../lib/nav/product-nav";
import type { RosterMember, ShiftView } from "../../../lib/scouting/shift-store";
import { ShiftRoster } from "./shift-roster";
import "./lineup.css";

type CoverageView =
  | {
      status: "setup_required";
      eventKey: null;
      generatedAt: string;
      message: string;
    }
  | {
      status: "live";
      eventKey: string;
      generatedAt: string;
      qualsOnly: boolean;
      summary: CoverageGapSummary;
      live: {
        focusMatchKeys: string[];
        focusSlots: CoverageGapSlot[];
        gapSlots: CoverageGapSlot[];
        doubleSlots: CoverageGapSlot[];
      };
      slots: CoverageGapSlot[];
      shifts: ShiftView[];
      roster: RosterMember[];
      canManageShifts: boolean;
      matchRange: { min: number; max: number } | null;
      shiftGapMatches: number;
    };

function teamLabel(slot: CoverageGapSlot): string {
  return slot.teamNumber != null ? String(slot.teamNumber) : slot.teamKey.replace(/^frc/i, "");
}

function statusLabel(status: CoverageGapSlot["status"]): string {
  if (status === "double") return "Double scouted";
  if (status === "unscouted") return "Unscouted";
  if (status === "assigned") return "Assigned, waiting";
  return "Covered";
}

function LineupRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = lineupRelatedLinks(orgId, {
    include: [...LINEUP_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related lineup-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function LineupNextActionsPanel({ actions }: { actions: LineupNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions lineup-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Scouting, Strategy, and Form builder — never DEMO %.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href} aria-label={action.label}>Open</a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function LineupShell({
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
  shell: LineupShellKind;
  error?: string;
  /** HTTP status of the failed load, so an expired session can offer sign-in. */
  errorStatus?: number | null;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = lineupNextActions({ orgId, shell });
  const copy = lineupShellCopy(shell);
  const competitionHref = hubHref("/competition", "scouting", orgId);
  const steps = shell === "setup" ? lineupSetupSteps(orgId) : [];
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
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const formsHref = hubHref("/competition", "forms", orgId);
  const commandHref = hubHref("/competition", "command", orgId);

  return (
    <main className="module-page lineup-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Lineup & coverage"}
          </>
        }
        title="Lineup & coverage"
        description={description}
      >
        <LineupRelatedStrip orgId={orgId} />
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
                ? "No schedule yet"
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
          <a className="app-button" href={orgId ? commandHref : "/workspace"}>
            {orgId ? "Set active event" : "Select workspace"}
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href={commandHref}>
              Sync event schedule
            </a>
            <a className="app-button secondary" href={scoutingHref}>
              Open Scouting
            </a>
            <a className="app-button secondary" href={formsHref}>
              Open Form builder
            </a>
            <a className="app-button secondary" href={strategyHref}>
              Open Strategy
            </a>
          </>
        ) : null}
      </EmptyState>
      {steps.length > 0 ? (
        <Panel className="lineup-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Scouting, Strategy, and Form builder — never DEMO %.</p>
          </header>
          <ul className="lineup-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted lineup-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href} aria-label={step.label}>Open</a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <LineupNextActionsPanel actions={actions} />
    </main>
  );
}

export default function LineupClient({ orgId }: { orgId: string }) {
  const [view, setView] = useState<CoverageView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [qualsOnly, setQualsOnly] = useState(true);
  const [focusMatch, setFocusMatch] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ orgId, window: "4" });
    if (!qualsOnly) params.set("qualsOnly", "0");
    if (focusMatch) params.set("matchKey", focusMatch);
    try {
      const response = await fetch(`/api/scouting/coverage?${params}`);
      const data = (await response.json()) as CoverageView & { error?: string };
      if (!response.ok) {
        setFetchFailed(true);
        setFailureStatus(response.status);
        setError(data.error ?? "Could not load coverage.");
        return;
      }
      setView(data);
      setUpdatedAt(data.generatedAt);
      setError("");
      setFailureStatus(null);
      setFetchFailed(false);
      if (data.status === "live" && data.live.focusMatchKeys[0] && !focusMatch) {
        setFocusMatch(data.live.focusMatchKeys[0]!);
      }
    } catch {
      setFetchFailed(true);
      setError("Network error — coverage will retry.");
    }
  }, [focusMatch, orgId, qualsOnly]);

  useEffect(() => {
    void load();
    // Battery-safe polling: >=15s cadence, paused while the tab is hidden.
    const timer = window.setInterval(() => {
      if (shouldPollLineup(document.visibilityState)) void load();
    }, LINEUP_POLL_MS);
    const onVisibility = () => {
      if (shouldPollLineup(document.visibilityState)) void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const matchOptions = useMemo(() => {
    if (!view || view.status !== "live") return [];
    const seen = new Set<string>();
    const options: Array<{ matchKey: string; label: string }> = [];
    for (const slot of view.slots) {
      if (seen.has(slot.matchKey)) continue;
      seen.add(slot.matchKey);
      options.push({
        matchKey: slot.matchKey,
        label: `${slot.compLevel.toUpperCase()} ${slot.matchNumber}`,
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
  const unscouted = view?.status === "live" ? view.summary.unscouted : 0;
  const gapCount = view?.status === "live" ? view.live.gapSlots.length : 0;

  const shell = classifyLineupShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    totalSlots,
  });
  const shellCopy = lineupShellCopy(shell);
  const nextActions = lineupNextActions({
    orgId,
    shell,
    totalSlots,
    unscouted,
    gapCount,
  });
  const competitionHref = hubHref("/competition", "scouting", orgId);
  const scoutingHref = hubHref("/competition", "scouting", orgId);
  const showTiles = view?.status === "live" && shouldShowLineupSummaryTiles(totalSlots);
  const loaded = view?.status === "live";

  if (shell === "loading") {
    return <LineupShell description={shellCopy.description} orgId={orgId} shell="loading" />;
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
      />
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
      />
    );
  }

  if (shell === "empty" || view?.status !== "live") {
    return (
      <LineupShell description={shellCopy.description} orgId={orgId} shell="empty" />
    );
  }

  return (
    <main className="module-page lineup-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Lineup & coverage"}
          </>
        }
        title="Lineup & coverage"
        description="Double-scouted vs unscouted robots for the live quals window. Attribution uses membership IDs — never typed scout names. Rates never invent DEMO %."
      >
        <div className="lineup-header-meta">
          <span className="lineup-live-pill" aria-live="polite">
            Live · refresh {LINEUP_POLL_MS / 1000}s
            {updatedAt ? ` · ${new Date(updatedAt).toLocaleTimeString()}` : ""}
          </span>
          <LineupRelatedStrip orgId={orgId} />
          <CopyShareLink orgId={orgId} />
          <button type="button" className="app-button secondary" onClick={() => window.print()}>
            Print
          </button>
          <a className="app-button secondary" href={scoutingHref}>
            Scout forms
          </a>
        </div>
      </PageHeader>

      {error ? (
        <p className="form-message" role="status">
          {error}
        </p>
      ) : null}

      <section className="lineup-controls" aria-label="Coverage filters">
        <label>
          Focus match
          <select value={focusMatch} onChange={(event) => setFocusMatch(event.target.value)}>
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
            checked={qualsOnly}
            onChange={(event) => setQualsOnly(event.target.checked)}
          />
          Quals only
        </label>
        <span className="app-muted">{view.eventKey}</span>
      </section>

      {showTiles ? (
        <section className="lineup-kpis" aria-label="Coverage summary">
          <article>
            <span>Unscouted</span>
            <strong>{formatLineupMetric(view.summary.unscouted, loaded)}</strong>
            <small>no entry yet</small>
          </article>
          <article>
            <span>Double scouted</span>
            <strong>{formatLineupMetric(view.summary.doubleCovered, loaded)}</strong>
            <small>{formatLineupCoverage(view.summary.doubleRate, loaded)} of slots</small>
          </article>
          <article>
            <span>Covered</span>
            <strong>
              {formatLineupMetric(view.summary.covered + view.summary.doubleCovered, loaded)}
            </strong>
            <small>{formatLineupCoverage(view.summary.coverageRate, loaded)} coverage</small>
          </article>
          <article>
            <span>Assigned waiting</span>
            <strong>{formatLineupMetric(view.summary.assignedWaiting, loaded)}</strong>
            <small>scout has the row</small>
          </article>
        </section>
      ) : null}

      <section className="lineup-split">
        <div className="lineup-panel" id="lineup-gaps">
          <header>
            <h2>Needs coverage</h2>
            <p className="app-muted">Unscouted or assigned-but-empty in the live window.</p>
          </header>
          {view.live.gapSlots.length ? (
            <ul className="lineup-gap-list">
              {view.live.gapSlots.map((slot) => (
                <li key={`${slot.matchKey}-${slot.teamKey}`} className={slot.status}>
                  <strong>
                    {slot.compLevel.toUpperCase()} {slot.matchNumber} · {teamLabel(slot)}
                  </strong>
                  <span>{statusLabel(slot.status)}</span>
                  <a href={lineupScoutNowHref(orgId, slot.matchKey, slot.teamKey)}>Scout now</a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="app-muted">No gaps in the current window.</p>
          )}
        </div>

        <div className="lineup-panel">
          <header>
            <h2>Double scouted</h2>
            <p className="app-muted">More than one membership-bound entry for the same robot.</p>
          </header>
          {view.live.doubleSlots.length ? (
            <ul className="lineup-gap-list">
              {view.live.doubleSlots.map((slot) => (
                <li key={`${slot.matchKey}-${slot.teamKey}`} className="double">
                  <strong>
                    {slot.compLevel.toUpperCase()} {slot.matchNumber} · {teamLabel(slot)}
                  </strong>
                  <span>
                    {slot.entryCount} scouts · {slot.scoutNames?.join(", ") || "members"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="app-muted">No doubles in the current window.</p>
          )}
        </div>
      </section>

      <ShiftRoster
        orgId={orgId}
        eventKey={view.eventKey}
        shifts={view.shifts ?? []}
        roster={view.roster ?? []}
        canManage={Boolean(view.canManageShifts)}
        matchRange={view.matchRange ?? null}
        gapMatches={view.shiftGapMatches ?? 0}
        onChanged={load}
      />

      <section className="lineup-board-wrap">
        <header>
          <h2>Live window</h2>
          <p className="app-muted">Next matches from the focus point — color shows gap vs double.</p>
        </header>
        {grouped.map((group) => {
          const sample = group.slots[0];
          return (
            <div key={group.matchKey} className="lineup-match">
              <h3>
                {sample
                  ? `${sample.compLevel.toUpperCase()} ${sample.matchNumber}`
                  : group.matchKey}
              </h3>
              <div className="lineup-board">
                {group.slots.map((slot) => (
                  <article key={`${slot.matchKey}-${slot.teamKey}`} className={slot.status}>
                    <b>{slot.alliance ?? "—"}</b>
                    <span>{teamLabel(slot)}</span>
                    <small>
                      {statusLabel(slot.status)}
                      {slot.status === "double" && slot.scoutNames?.length
                        ? ` · ${slot.scoutNames.join(" / ")}`
                        : ""}
                    </small>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
        {!grouped.length ? (
          <p className="app-muted">
            Match schedule is empty. Sync TBA after the event schedule publishes — nothing is
            invented.
          </p>
        ) : null}
      </section>

      <LineupNextActionsPanel actions={nextActions} />
      <p className="app-muted lineup-footer-links">
        Also see{" "}
        <a href={withOrgHref("/scout-coverage-live", orgId)}>Scout Coverage Live</a>
        {" · "}
        <a href={hubHref("/competition", "forms", orgId)}>Form builder</a>
        {" · "}
        <a href={hubHref("/competition", "strategy", orgId)}>Strategy</a>
      </p>
    </main>
  );
}
