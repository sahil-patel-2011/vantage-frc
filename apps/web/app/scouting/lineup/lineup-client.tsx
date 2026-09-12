"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { EmptyState, PageHeader, Button } from "../../../components/ui";
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
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";
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
      eventKey: string;
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
      scouts: CoverageScout[];
      schemaRoles: { status: string; warnings: SchemaRoleWarning[] };
      };

function isCoverageView(value: unknown): value is CoverageView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
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
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
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
        <p className="app-muted">Each one opens the page where you finish the work.</p>
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
        {shell === "empty" ? (
          <Button as="a" variant="primary" href={commandHref}>
            Sync event schedule
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
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<CoverageView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const params = new URLSearchParams({ orgId, window: "4" });
    if (!qualsOnly) params.set("qualsOnly", "0");
    if (focusMatch) params.set("matchKey", focusMatch);
    let hadCache = Boolean(viewRef.current);
    if (!viewRef.current) {
      try {
        const cached = await getFeatureSnapshot<CoverageView>("lineup", orgId || "_");
        if (!viewRef.current && cached?.data && isCoverageView(cached.data)) {
          setView(cached.data);
          setUpdatedAt(cached.data.generatedAt);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
          if (cached.data.status === "live" && cached.data.live.focusMatchKeys[0] && !focusMatch) {
            setFocusMatch(cached.data.live.focusMatchKeys[0]!);
          }
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
    }
    try {
      const response = await fetch(`/api/scouting/coverage?${params}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as CoverageView & { error?: string };
      if (!response.ok || !isCoverageView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Lineup. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
          setFailureStatus(response.status);
          setError(data.error ?? "Could not load coverage.");
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
      if (data.status === "live" && data.live.focusMatchKeys[0] && !focusMatch) {
        setFocusMatch(data.live.focusMatchKeys[0]!);
      }
      await persistLineupSnapshot(orgId, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Lineup. Showing the last copy on this device.");
        setFetchFailed(false);
      } else {
        setFetchFailed(true);
        setError("Network error — coverage will retry.");
      }
    }
  }, [focusMatch, orgId, qualsOnly]);

  /**
   * Coverage mutations go to the same canonical route as the read, so the response IS the
   * refreshed board — no optimistic second source of truth to drift.
   */
  const mutate = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      try {
        const response = await fetch("/api/scouting/coverage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, focusMatchKey: focusMatch, qualsOnly, ...body }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as CoverageView & { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Could not update coverage.");
          return;
        }
        setView(data);
        setUpdatedAt(data.generatedAt);
        setError("");
        void persistLineupSnapshot(orgId, data);
      } catch {
        setError("Network error — the assignment was not saved.");
      } finally {
        setBusy(false);
      }
    },
    [focusMatch, orgId, qualsOnly],
  );

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
    return (
      <LineupShell description={shellCopy.description} orgId={orgId} shell="empty">
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
        description="Double-scouted vs unscouted robots for the live quals window. Names come from signed-in scouts — never typed names."
      >
        <div className="lineup-header-meta">
          <span className="lineup-live-pill" aria-live="polite">
            Live · refresh {LINEUP_POLL_MS / 1000}s
            {updatedAt ? ` · ${new Date(updatedAt).toLocaleTimeString()}` : ""}
          </span>
          <LineupRelatedStrip orgId={orgId} />
          <CopyShareLink orgId={orgId} />
          <Button variant="secondary" type="button" onClick={() => window.print()}>
            Print
          </Button>
          <Button as="a" variant="secondary" href={scoutingHref}>
            Scout forms
          </Button>
        </div>
      </PageHeader>

      <OfflineBanner feature="Lineup & coverage" fromCache={fromCache} cachedAt={cachedAt} />

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
        {view.canAssign ? (
          <Button variant="secondary" type="button" disabled={busy || !view.live.gapSlots.length} onClick={() => void mutate({ action: "auto-assign" })}>
            {busy ? "Assigning…" : "Auto-assign open gaps"}
          </Button>
        ) : null}
        <span className="app-muted">{view.eventKey}</span>
      </section>

      {view.schemaRoles.warnings.length ? (
        <section className="lineup-panel" aria-label="Form to strategy mapping">
          <header>
            <h2>Form mapping</h2>
            <p className="app-muted">
              What your published form actually hands Strategy — a missing mapping reads as null,
              not as zero.
            </p>
          </header>
          <ul className="lineup-setup-steps">
            {view.schemaRoles.warnings.map((warning) => (
              <li key={warning.id}>
                <div>
                  <strong>
                    {warning.severity === "blocking" ? "Strategy reads null" : "Heads up"}
                  </strong>
                  <p className="app-muted lineup-tip">{warning.message}</p>
                </div>
                <Button as="a" variant="secondary" href={hubHref("/competition", "forms", orgId)}>
                  Open Form builder
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
                  {view.canAssign ? (
                    <label className="lineup-assign">
                      <span className="app-muted">Assign</span>
                      <select
                        value=""
                        disabled={busy}
                        onChange={(event) => {
                          const assignee = event.target.value;
                          if (!assignee) return;
                          void mutate({
                            action: "assign",
                            matchKey: slot.matchKey,
                            teamKey: slot.teamKey,
                            userId: assignee,
                          });
                        }}
                      >
                        <option value="">Pick a scout…</option>
                        {view.scouts.map((scout) => (
                          <option key={scout.userId} value={scout.userId}>
                            {scout.isMe ? `${scout.name} (me)` : scout.name} · {scout.assignedCount}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
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
            <p className="app-muted">More than one signed-in scout logged this robot.</p>
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
            Match schedule is empty. Sync the event after the schedule publishes.
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
