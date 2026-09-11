"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import { OfflineBanner } from "../../components/offline-banner";
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
import { withOrgHref } from "../../lib/nav/product-nav";
import { fetchProductSession } from "../../lib/nav/product-session";
import { FEATURE_API_TIMEOUT_MS, readOrgIdFromSearch } from "../../lib/nav/resolve-org";
import { clearFeatureSnapshot, getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
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
      /** Where the next recorded pick lands on the ONE pick list's draft board. */
      nextSlot: { allianceSeed: number; pickSlot: "captain" | "first" | "second" } | null;
      lastPick: {
        allianceSeed: number;
        pickSlot: "captain" | "first" | "second";
        teamKey: string | null;
        teamNumber: number | null;
        draftedAt: string | null;
      } | null;
      draftedCount: number;
    }
  | {
      status: "setup_required";
      message: string;
      orgId: string | null;
      eventKey: string | null;
    };

function isPickClockView(value: unknown): value is PickClockView {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return row.status === "ready" || row.status === "setup_required";
}

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
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
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

function PickClockShell({
  orgId,
  shell,
  error,
  errorStatus,
  onRetry,
  fromCache = false,
  cachedAt = null,
  children,
}: {
  orgId?: string | null;
  shell: PickClockShellKind;
  error?: string;
  /** HTTP status of the failed load, so an expired session offers sign-in, not Retry. */
  errorStatus?: number | null;
  onRetry?: () => void;
  fromCache?: boolean;
  cachedAt?: string | null;
  children?: ReactNode;
}) {
  const copy = pickClockShellCopy(shell);
  const setup = shell === "setup" ? pickClockSetupSteps(orgId)[0] : null;
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
  const teamDataHref = withOrgHref("/team/data", orgId);

  return (
    <main className="module-page app-shell-page pck-page pck-workbench soft-gate">
      <PageHeader
        breadcrumbs="Competition / Pick clock"
        title="Pick Clock"
        description="Next best pick + why — built for the 45-second alliance selection timer."
      >
        <PickClockRelatedStrip orgId={orgId} />
      </PageHeader>
      <OfflineBanner feature="Pick clock" fromCache={fromCache} cachedAt={cachedAt} />
      {children}
      <EmptyState
        soft
        className="pck-empty"
        badge={failure ? undefined : copy.badge}
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
        {shell === "error" && onRetry && failure?.showRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {setup ? (
          <Button as="a" variant="primary" href={setup.href}>
            {setup.label}
          </Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href={teamDataHref}>
            Sync Team Data
          </Button>
        ) : null}
      </EmptyState>
    </main>
  );
}

export default function PickClockClient({
  orgId: initialOrgId,
}: {
  orgId?: string;
  embedded?: boolean;
} = {}) {
  const [orgId, setOrgId] = useState(initialOrgId?.trim() ?? "");
  const [view, setView] = useState<PickClockView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [skipOffset, setSkipOffset] = useState(0);
  const [writing, setWriting] = useState(false);
  const [pickMessage, setPickMessage] = useState("");
  const [conflict, setConflict] = useState<{ message: string } | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<PickClockView | null>(null);
  viewRef.current = view;

  useEffect(() => {
    const seeded = initialOrgId?.trim() || readOrgIdFromSearch(window.location.search) || "";
    if (seeded) {
      setOrgId(seeded);
      return;
    }
    void fetchProductSession().then((data) => {
      if (!data?.orgId) {
        setLoading(false);
        return;
      }
      setOrgId(data.orgId);
    });
  }, [initialOrgId]);

  const load = useCallback(async (id: string) => {
    if (!id) {
      setLoading(false);
      setFetchFailed(false);
      return;
    }
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<PickClockView>("pick-clock", id || "_");
      if (!viewRef.current && cached?.data && isPickClockView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        setLoading(false);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    if (!hadCache) setLoading(true);
    setFetchFailed(false);
    setErrorStatus(null);
    try {
      // The ONE pick list owns the draft board, and /api/strategy/pick-clock reads it server-side,
      // so anything the desk (or this clock) already drafted is already out of the pool. No second
      // client-side exclusion pass to drift from it.
      const response = await fetch(`/api/strategy/pick-clock?orgId=${encodeURIComponent(id)}`, {
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as PickClockView | { error?: string };
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setError("error" in data && data.error ? data.error : "Could not load pick clock.");
        setErrorStatus(response.status);
        void clearFeatureSnapshot("pick-clock", id || "_");
        if (id) void clearFeatureSnapshot("pick-clock", id);
        setLoading(false);
        return;
      }
      if (!response.ok || !("status" in data) || !isPickClockView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Pick clock. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setError("error" in data && data.error ? data.error : "Could not load pick clock.");
          setErrorStatus(response.status);
          setView(null);
          setFetchFailed(true);
        }
        setLoading(false);
        return;
      }
      setError("");
      setView(data);
      setFetchFailed(false);
      setSkipOffset(0);
      setFromCache(false);
      setCachedAt(null);
      if (data.status === "ready" && data.orgId) setOrgId(data.orgId);
      if (data.status === "setup_required" && data.orgId) setOrgId(data.orgId);
      try {
        await putFeatureSnapshot("pick-clock", id || "_", data);
        if (!id) await putFeatureSnapshot("pick-clock", "_", data);
      } catch {
        // Live Pick clock already painted; IndexedDB is best-effort.
      }
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Pick clock. Showing the last copy on this device.");
        setFetchFailed(false);
      } else {
        setError("Could not load pick clock.");
        setView(null);
        setFetchFailed(true);
      }
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
     
  }, [orgId]);

  /**
   * Record / undo write to the ONE pick list's draft board. A 409 means another device already
   * filled the slot — say who, and let the operator record over it on purpose.
   */
  const writePick = useCallback(
    async (body: Record<string, unknown>) => {
      if (!orgId) return;
      const ready = view?.status === "ready" ? view : null;
      setWriting(true);
      setPickMessage("");
      try {
        const response = await fetch("/api/strategy/pick-clock", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          body: JSON.stringify({
            orgId,
            eventKey: ready?.eventKey,
            pickListId: ready?.pickListId,
            ...body,
          }),
        });
        const data = (await response.json()) as {
          status?: string;
          message?: string;
          error?: string;
        };
        if (response.status === 409) {
          setConflict({ message: data.message ?? "That slot is already filled." });
          return;
        }
        if (!response.ok) {
          setPickMessage(data.error ?? "Could not record the pick.");
          return;
        }
        setConflict(null);
        setPickMessage(data.message ?? "");
        setSkipOffset(0);
        setStartedAt(null);
        await load(orgId);
      } catch {
        setPickMessage("Could not record the pick. Check your connection and try again.");
      } finally {
        setWriting(false);
      }
    },
    [load, orgId, view],
  );

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
        fromCache={fromCache}
        cachedAt={cachedAt}
        error={
          shell === "error"
            ? error || "Could not load pick clock."
            : shell === "setup" && view?.status === "setup_required" && view.message
              ? `${view.message} Recommendations stay blank until real event metrics exist.`
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
  const pickDeskHref = withOrgHref("/strategy?tab=picks", resolvedOrgId);
  const showTiles = shouldShowPickClockSummaryTiles(availableCount);
  const readyActions = pickClockNextActions({
    orgId: resolvedOrgId,
    shell: hasRecommendation && availableCount > 0 ? "ready" : "empty",
    eventKey: view?.status === "ready" ? view.eventKey : view?.eventKey,
    hasRecommendation,
    availableCount,
    excludedCount,
  });

  const readyView = view?.status === "ready" ? view : null;
  // A full board still has to undo from this page — leaving for the desk is the bug this clock closes.
  const stayOnBoard = Boolean(readyView && (readyView.lastPick || readyView.nextSlot));

  if (!readyView || (shell === "empty" && !stayOnBoard)) {
    return (
      <PickClockShell
        orgId={resolvedOrgId}
        shell="empty"
        fromCache={fromCache}
        cachedAt={cachedAt}
        error={
          excludedCount > 0
            ? `${excludedCount} already taken on the draft board. Clear slots or refresh after updates.`
            : undefined
        }
      />
    );
  }

  const queue = readyView.recommendation
    ? [readyView.recommendation, ...readyView.alternates]
    : [];
  const active = queue[Math.min(skipOffset, Math.max(0, queue.length - 1))] ?? null;

  return (
    <main className="module-page app-shell-page pck-page pck-workbench">
      <PageHeader
        breadcrumbs="Competition / Pick clock"
        title="Pick Clock"
        description={
          readyView.eventName
            ? `${readyView.eventName} · ${PICK_CLOCK_SECONDS}s selection clock.`
            : `${PICK_CLOCK_SECONDS}-second alliance pick assistant.`
        }
      >
        <PickClockRelatedStrip orgId={resolvedOrgId} />
        <Button variant="secondary" type="button" onClick={() => { if (resolvedOrgId) void load(resolvedOrgId); }}>
          Refresh
        </Button>
      </PageHeader>

      <OfflineBanner feature="Pick clock" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? <p className="edc-banner error">{error}</p> : null}
      {pickMessage ? (
        <p className="edc-banner" role="status">
          {pickMessage}
        </p>
      ) : null}
      {conflict ? (
        <p className="edc-banner error" role="alert">
          {conflict.message}{" "}
          <Button variant="secondary" type="button" disabled={writing || !active} onClick={() => { if (!active) return; void writePick({ action: "record-pick", teamKey: active.teamKey, rationale: active.headline, ...(readyView.nextSlot ?? {}), force: true, }); }}>
            Record over it
          </Button>
        </p>
      ) : null}

      {showTiles ? (
        <div className="pck-kpis" aria-label="Pick clock counts">
          <article>
            <strong>{formatPickClockMetric(availableCount, true)}</strong>
            <small>available</small>
          </article>
          <article>
            <strong>
              {formatPickClockMetric(readyView.scoutedTeams, true)}/
              {formatPickClockMetric(readyView.teamCount, true)}
            </strong>
            <small>scouted</small>
          </article>
          <article>
            <strong>{formatPickClockMetric(excludedCount, true)}</strong>
            <small>already taken</small>
          </article>
        </div>
      ) : null}

      {readyView.pickMode === "low_data_tba" ? (
        <p className="pck-mode-banner" role="status">
          <span className="app-badge setup">Low-data rankings</span>
          {readyView.pickModeReason ?? "Ranking from synced event numbers until scouting coverage improves."}
        </p>
      ) : null}

      <div className={`pck-clock pck-${urgency}`} aria-live="polite">
        <span className="pck-clock-label">{remaining == null ? "Ready" : "Seconds left"}</span>
        <strong className="pck-clock-value">{remaining == null ? PICK_CLOCK_SECONDS : remaining}</strong>
        <div className="pck-clock-actions">
          {startedAt == null ? (
            <Button variant="primary" type="button" onClick={() => { setStartedAt(Date.now()); setNow(Date.now()); }}>
              Start {PICK_CLOCK_SECONDS}s
            </Button>
          ) : (
            <Button variant="secondary" type="button" onClick={() => { setStartedAt(Date.now()); setNow(Date.now()); }}>
              Reset clock
            </Button>
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
              ? `${excludedCount} already taken on the draft board. Clear slots or refresh after updates.`
              : "Load event metrics or build a pick list on Strategy first."
          }
          badge="No teams left to recommend"
          badgeTone="setup"
        >
          <div className="pck-setup-links">
            <Button variant="secondary" type="button" disabled={writing || !readyView.lastPick} onClick={() => void writePick({ action: "undo-pick" })}>
              {readyView.lastPick
                ? `Undo ${readyView.lastPick.teamNumber ?? readyView.lastPick.teamKey?.replace(/^frc/i, "")}`
                : "Nothing to undo"}
            </Button>
            <Button as="a" variant="primary" href={pickDeskHref}>
              Open Pick desk
            </Button>
          </div>
        </EmptyState>
      ) : (
        <section className="pck-hero soft-panel" aria-label="Next best pick">
          <p className="pck-eyebrow">
            Next pick
            {readyView.pickListName ? ` · ${readyView.pickListName}` : ""}
            {readyView.availableCount ? ` · ${readyView.availableCount} available` : ""}
            {readyView.scoutedTeams != null && readyView.teamCount
              ? ` · ${readyView.scoutedTeams}/${readyView.teamCount} scouted`
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
            <Button variant="primary" type="button" disabled={writing || !readyView.nextSlot} onClick={() => void writePick({ action: "record-pick", teamKey: active.teamKey, rationale: active.headline, ...(readyView.nextSlot ?? {}), }) }>
              {writing
                ? "Recording…"
                : readyView.nextSlot
                  ? `Record at alliance ${readyView.nextSlot.allianceSeed} ${readyView.nextSlot.pickSlot}`
                  : "Board is full"}
            </Button>
            <Button variant="secondary" type="button" disabled={writing || !readyView.lastPick} onClick={() => void writePick({ action: "undo-pick" })}>
              {readyView.lastPick
                ? `Undo ${readyView.lastPick.teamNumber ?? readyView.lastPick.teamKey?.replace(/^frc/i, "")}`
                : "Nothing to undo"}
            </Button>
            <Button variant="secondary" type="button" disabled={queue.length < 2} onClick={() => setSkipOffset((n) => (n + 1) % queue.length)}>
              Show alternate
            </Button>
            <Button as="a" variant="secondary"
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
            </Button>
            <Button as="a" variant="secondary"
              href={withOrgHref(
                `/chemistry?teams=${encodeURIComponent(teamDisplay(active))}`,
                resolvedOrgId,
              )}
            >
              Chemistry
            </Button>
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

      {readyView.sources.length ? (
        <p className="pck-sources app-muted">
          Signals: {readyView.sources.join(" · ")}
          {readyView.pickMode === "low_data_tba" ? " · quick-pick mode" : " · pick-desk scoring"}
          {readyView.epaDrifts.length
            ? ` · ${readyView.epaDrifts.length} rating-drift callout${readyView.epaDrifts.length === 1 ? "" : "s"}`
            : ""}
        </p>
      ) : null}
    </main>
  );
}
