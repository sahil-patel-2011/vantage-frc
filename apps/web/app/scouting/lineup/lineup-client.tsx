"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { EmptyState, PageHeader, Button } from "../../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import { CopyShareLink } from "../../../components/copy-share-link";
import type { CoverageGapSlot, CoverageGapSummary } from "@vantage/scouting/coverage";
import {
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
  type LineupNextAction,
  type LineupShellKind,
} from "../../../lib/scouting/lineup-related";
import { hubHref } from "../../../lib/nav/hubs";
import { matchLabelFromKey } from "../../../lib/matches/no-next-match";
import { scoutEventLabel } from "../../../lib/scouting/scouting-related";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { clearFeatureSnapshot, getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";
import { assignmentReceiptMessage, isAssignmentReceipt, type AssignmentReceipt } from "../../../lib/scouting/assignment-receipt";
import { AssignmentRangeForm } from "./assignment-range-form";
import type { CoverageScopeSummary } from "../../../lib/scouting/coverage";
import "./lineup.css";

type CoverageScout = {
  userId: string;
  name: string;
  role: string;
  assignedCount: number;
  isMe: boolean;
};

type SchemaRoleWarning = {
  id: string;
  severity: "blocking" | "warning";
  message: string;
};

type CoverageView =
  | {
      status: "setup_required";
      eventKey: null;
      generatedAt: string;
      message: string;
    }
  | {
      status: "live";
      orgId?: string;
      eventKey: string;
      eventName?: string | null;
      generatedAt: string;
      qualsOnly: boolean;
      canAssign: boolean;
      summary: CoverageGapSummary;
      live: {
        focusMatchKeys: string[];
        focusSlots: CoverageGapSlot[];
        gapSlots: CoverageGapSlot[];
        doubleSlots: CoverageGapSlot[];
      };
      slots: CoverageGapSlot[];
      /** Played vs upcoming robots. Optional: an older saved copy has none. */
      scope?: CoverageScopeSummary;
      scouts: CoverageScout[];
      schemaRoles: { status: string; warnings: SchemaRoleWarning[] };
      };

function isCoverageView(value: unknown): value is CoverageView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  if (status === "setup_required") return typeof (value as { message?: unknown }).message === "string";
  const view = value as Extract<CoverageView, { status: "live" }>;
  return status === "live" && typeof view.eventKey === "string" && Array.isArray(view.slots) && Array.isArray(view.scouts) && Boolean(view.summary) &&
    Array.isArray(view.live?.focusMatchKeys) && Array.isArray(view.live?.focusSlots) && Array.isArray(view.live?.gapSlots) && Array.isArray(view.live?.doubleSlots) && Array.isArray(view.schemaRoles?.warnings);
}

async function persistLineupSnapshot(orgHint: string, data: CoverageView): Promise<void> {
  const cacheOrg = orgHint.trim();
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("lineup", cacheOrg, data);
    if (!orgHint.trim() || cacheOrg === "_") return;
    await putFeatureSnapshot("lineup", "_", data);
  } catch {
    // Live coverage already painted; IndexedDB is best-effort.
  }
}

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

function LineupNextActionsPanel({ actions }: { actions: LineupNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions lineup-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
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
      {shell === "ready" ? <LineupNextActionsPanel actions={actions} /> : null}
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
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [receipt, setReceipt] = useState<AssignmentReceipt | null>(null);
  const mutationPending = useRef(false);
  const loadGeneration = useRef(0);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<CoverageView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    if (mutationPending.current) return;
    const generation = ++loadGeneration.current;
    setLoading(true);
    const params = new URLSearchParams({ orgId, window: "4" });
    if (!qualsOnly) params.set("qualsOnly", "0");
    if (focusMatch) params.set("matchKey", focusMatch);
    let hadCache = Boolean(viewRef.current);
    if (!viewRef.current) {
      try {
        const cached = await getFeatureSnapshot<CoverageView>("lineup", orgId || "_");
        if (generation !== loadGeneration.current) return;
        if (!viewRef.current && cached?.data && isCoverageView(cached.data)) {
          setView(cached.data);
          setUpdatedAt(cached.data.generatedAt);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
    }
    if (generation !== loadGeneration.current) return;
    try {
      const response = await fetch(`/api/scouting/coverage?${params}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as CoverageView & { error?: string };
      if (generation !== loadGeneration.current) return;
      if (response.status === 401 || response.status === 403) {
        viewRef.current = null; setView(null); setReceipt(null); setFromCache(false); setCachedAt(null);
        setFetchFailed(true); setFailureStatus(response.status); setError(data?.error ?? "Your access to scouting assignments has changed.");
        void Promise.all([clearFeatureSnapshot("lineup", orgId), clearFeatureSnapshot("lineup", "_")]).catch(() => undefined);
        return;
      }
      if (!response.ok || !isCoverageView(data) || (data.status === "live" && data.orgId !== orgId)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Lineup. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
          setFailureStatus(response.status);
          setError(data?.error ?? "Could not load coverage.");
        }
        return;
      }
      setView(data);
      setUpdatedAt(data.generatedAt);
      setError("");
      setFailureStatus(null);
      setFetchFailed(false);
      setFromCache(false);
      setCachedAt(null);
      await persistLineupSnapshot(orgId, data);
    } catch {
      if (generation !== loadGeneration.current) return;
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Lineup. Showing the last copy on this device.");
        setFetchFailed(false);
      } else {
        setFetchFailed(true);
        setError("Could not load coverage. Refresh when your connection returns.");
      }
    } finally { if (generation === loadGeneration.current) setLoading(false); }
  }, [focusMatch, orgId, qualsOnly]);

  /**
   * Coverage mutations go to the same canonical route as the read, so the response IS the
   * refreshed board — no optimistic second source of truth to drift.
   */
  const mutate = useCallback(
    async (body: Record<string, unknown>): Promise<AssignmentReceipt | null> => {
      if (mutationPending.current || loading || viewRef.current?.status !== "live") return null;
      const eventKey = viewRef.current.eventKey;
      mutationPending.current = true;
      const generation = ++loadGeneration.current;
      setBusy(true);
      setReceipt(null); setError("");
      try {
        const response = await fetch("/api/scouting/coverage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, eventKey, focusMatchKey: focusMatch, qualsOnly, ...body }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as CoverageView & { error?: string; mutation?: unknown };
        if (generation !== loadGeneration.current) return null;
        if (!response.ok || !isCoverageView(data) || data.status !== "live" || data.orgId !== orgId || data.eventKey !== eventKey ||
          !isAssignmentReceipt(data.mutation) || data.mutation.action !== body.action || data.mutation.eventKey !== eventKey) {
          setError(data?.error ?? "The assignment could not be confirmed. Your choices are still here; refresh coverage before retrying.");
          return null;
        }
        setView(data);
        setUpdatedAt(data.generatedAt);
        setError("");
        setReceipt(data.mutation); setFromCache(false); setCachedAt(null);
        void persistLineupSnapshot(orgId, data);
        return data.mutation;
      } catch {
        setError("The assignment could not be confirmed. Your choices are still here; refresh coverage before retrying.");
        return null;
      } finally {
        mutationPending.current = false;
        setBusy(false);
      }
    },
    [focusMatch, orgId, qualsOnly, loading],
  );

  useEffect(() => {
    void load();
    // Refresh when returning to the page; no recurring polling workload.
    const onVisibility = () => {
      if (shouldPollLineup(document.visibilityState)) void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      loadGeneration.current += 1;
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
        <OfflineBanner feature="Lineup & coverage" fromCache={fromCache} cachedAt={cachedAt} />
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
        <OfflineBanner feature="Lineup & coverage" fromCache={fromCache} cachedAt={cachedAt} />
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
        <OfflineBanner feature="Lineup & coverage" fromCache={fromCache} cachedAt={cachedAt} />
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
        <OfflineBanner feature="Lineup & coverage" fromCache={fromCache} cachedAt={cachedAt} />
      </LineupShell>
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
        description="Who scouts which robot in the next few matches: robots with no scout, robots scouted twice, and one tap to assign."
      >
        <div className="lineup-header-meta">
          <span className="lineup-live-pill" aria-live="polite">
            {fromCache ? "Saved on this device" : "Last updated"}
            {updatedAt ? ` · ${new Date(updatedAt).toLocaleTimeString()}` : ""}
          </span>
          <Button variant="secondary" type="button" disabled={busy || loading} onClick={() => void load()}>{loading ? "Refreshing…" : "Refresh coverage"}</Button>
          <LineupRelatedStrip orgId={orgId} />
          <CopyShareLink orgId={orgId} />
          <Button variant="secondary" type="button" onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </PageHeader>

      <OfflineBanner feature="Lineup & coverage" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="form-message" role="status">
          {error}
        </p>
      ) : null}
      {receipt ? <section className="lineup-receipt" role="status"><p>{assignmentReceiptMessage(receipt)}</p>{receipt.refused.length ? <ul>{receipt.refused.map((reason, index) => <li key={index}>{reason}</li>)}</ul> : null}</section> : null}

      <section className="lineup-controls" aria-label="Coverage filters">
        <label>
          Focus match
          <select value={focusMatch || view.live.focusMatchKeys[0] || ""} disabled={busy || loading} onChange={(event) => setFocusMatch(event.target.value)}>
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
            disabled={busy || loading}
            onChange={(event) => setQualsOnly(event.target.checked)}
          />
          Quals only
        </label>
        {view.canAssign ? (
          <Button variant="secondary" type="button" disabled={busy || loading || !view.scouts.length || !(view.scope ? view.scope.upcomingNoScout : view.summary.unscouted)} onClick={() => void mutate({ action: "auto-assign" })}>
            {busy ? "Assigning…" : "Auto-assign upcoming robots"}
          </Button>
        ) : null}
        <span className="app-muted">
          {scoutEventLabel({ eventName: view.eventName, eventKey: view.eventKey }) ?? "Your event"}
        </span>
      </section>

      {view.canAssign ? (
        <AssignmentRangeForm
          key={view.eventKey}
          matchKeys={view.slots}
          scouts={view.scouts}
          qualsOnly={qualsOnly}
          busy={busy || loading}
          onAssign={mutate}
        />
      ) : null}

      {view.schemaRoles.warnings.length ? (
        <section className="lineup-panel" aria-label="Form to strategy mapping">
          <header>
            <h2>What Strategy can read from your form</h2>
            <p className="app-muted">
              When a question isn&apos;t marked, Strategy shows a blank for it, never a zero.
            </p>
          </header>
          <ul className="lineup-setup-steps">
            {view.schemaRoles.warnings.map((warning) => (
              <li key={warning.id}>
                <div>
                  <strong>
                    {warning.severity === "blocking" ? "Strategy can't use this yet" : "Heads up"}
                  </strong>
                  <p className="app-muted lineup-tip">{warning.message}</p>
                </div>
              </li>
            ))}
          </ul>
          {view.canAssign ? <Button as="a" variant="secondary" href={hubHref("/competition", "forms", orgId)}>Review form mapping</Button> : null}
        </section>
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

      <section className="lineup-split">
        <div className="lineup-panel" id="lineup-gaps">
          <header>
            <h2>Needs coverage</h2>
            <p className="app-muted">Robots in these matches with no report yet.</p>
          </header>
          {view.live.gapSlots.length ? (
            <ul className="lineup-gap-list">
              {view.live.gapSlots.map((slot) => (
                <li key={`${slot.matchKey}-${slot.teamKey}`} className={slot.status}>
                  <strong>
                    {slotMatchLabel(slot)} · {teamLabel(slot)}
                  </strong>
                  <span>{statusLabel(slot.status)}</span>
                  {slot.assignedScouts?.length ? <span>Assigned: {slot.assignedScouts.map(scout => scout.name).join(", ")}</span> : null}
                  <a href={lineupScoutNowHref(orgId, slot.matchKey, slot.teamKey)}>Scout now</a>
                  {view.canAssign ? (
                    <SlotAssignment key={`${view.eventKey}:${slot.matchKey}:${slot.teamKey}`} slot={slot} scouts={view.scouts} busy={busy || loading} mutate={mutate} />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="app-muted">Every robot in these matches has a report.</p>
          )}
        </div>

        <div className="lineup-panel">
          <header>
            <h2>Scouted twice</h2>
            <p className="app-muted">More than one scout saved a report for this robot.</p>
          </header>
          {view.live.doubleSlots.length ? (
            <ul className="lineup-gap-list">
              {view.live.doubleSlots.map((slot) => (
                <li key={`${slot.matchKey}-${slot.teamKey}`} className="double">
                  <strong>
                    {slotMatchLabel(slot)} · {teamLabel(slot)}
                  </strong>
                  <span>
                    {slot.entryCount} scouts · {slot.scoutNames?.join(", ") || "members"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="app-muted">No robot in these matches was scouted twice.</p>
          )}
        </div>
      </section>

      <section className="lineup-board-wrap">
        <header>
          <h2>Next matches</h2>
          <p className="app-muted">Starting from the focus match. Each robot shows who has it.</p>
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
                    <small>
                      {statusLabel(slot.status)}
                      {slot.assignedScouts?.length ? ` · Assigned: ${slot.assignedScouts.map(scout => scout.name).join(" / ")}` : ""}
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
            {view.canAssign
              ? "No match schedule yet. Update the event data once the schedule is out."
              : "No match schedule yet. An owner or admin updates the event data once it is out."}
          </p>
        ) : null}
      </section>

    </main>
  );
}

function SlotAssignment({ slot, scouts, busy, mutate }: { slot: CoverageGapSlot; scouts: CoverageScout[]; busy: boolean; mutate: (body: Record<string, unknown>) => Promise<AssignmentReceipt | null> }) {
  const [userId, setUserId] = useState("");
  return <div className="lineup-assign"><label><span className="app-muted">Scout for {slotMatchLabel(slot)} · Team {teamLabel(slot)}</span>
    <select value={userId} disabled={busy} onChange={event => setUserId(event.target.value)}>
      <option value="">Choose a scout…</option>
      {scouts.map(scout => <option key={scout.userId} value={scout.userId}>{scout.name}{scout.isMe ? " (me)" : ""} · {scout.assignedCount} assigned</option>)}
    </select></label>
    <Button variant="secondary" disabled={busy || !scouts.some(scout => scout.userId === userId)} onClick={() => {
      void mutate({ action: "assign", matchKey: slot.matchKey, teamKey: slot.teamKey, userId }).then(result => {
        if (result && !result.refused.length) setUserId("");
      });
    }}>Assign scout</Button>
  </div>;
}
