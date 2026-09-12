"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import {
  Badge,
  type BadgeTone,
  EmptyState,
  ErrorState,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile, Button } from "../../components/ui";
import type { CoverageStatus } from "../../lib/scout-coverage-live/types";
import type { ScoutCoverageLiveView } from "../../lib/scout-coverage-live/compute-scout-coverage-live";
import {
  SCOUT_COVERAGE_LIVE_RELATED_INCLUDE,
  classifyScoutCoverageLiveShell,
  formatScoutCoverageLiveMetric,
  formatScoutCoverageLiveRate,
  scoutCoverageLiveNextActions,
  scoutCoverageLiveRelatedLinks,
  scoutCoverageLiveSetupSteps,
  scoutCoverageLiveShellCopy,
  shouldShowScoutCoverageLiveSummaryTiles,
  type ScoutCoverageLiveNextAction,
  type ScoutCoverageLiveShellKind,
} from "../../lib/scout-coverage-live/scout-coverage-live-related";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./scout-coverage-live.css";

const statusToneMap: Record<CoverageStatus, BadgeTone> = {
  zero: "demo",
  thin: "setup",
  covered: "good",
};

function statusTone(status: CoverageStatus): BadgeTone {
  return statusToneMap[status] ?? "neutral";
}

function statusLabel(status: CoverageStatus): string {
  if (status === "zero") return "No coverage";
  if (status === "thin") return "Thin";
  return "Covered";
}

type LiveView = Extract<ScoutCoverageLiveView, { status: "live" }>;

function isScoutCoverageLiveView(value: unknown): value is ScoutCoverageLiveView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistScoutCoverageLiveSnapshot(
  orgHint: string,
  data: ScoutCoverageLiveView,
): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("scout-coverage-live", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("scout-coverage-live", "_", data);
  } catch {
    // Live Coverage already painted; IndexedDB is best-effort.
  }
}

function ScoutCoverageLiveRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = scoutCoverageLiveRelatedLinks(orgId, {
    include: [...SCOUT_COVERAGE_LIVE_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related scout-coverage-live-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function ScoutCoverageLiveNextActionsPanel({ actions }: { actions: ScoutCoverageLiveNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions scout-coverage-live-next-actions"
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

function ScoutCoverageLiveShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: ScoutCoverageLiveShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = scoutCoverageLiveNextActions({ orgId, shell });
  const copy = scoutCoverageLiveShellCopy(shell);
  const competitionHref = hubHref("/competition", "scouting", orgId);
  const setup = shell === "setup" ? scoutCoverageLiveSetupSteps(orgId)[0] : null;
  const commandHref = hubHref("/competition", "command", orgId);

  return (
    <main className="module-page scout-coverage-live-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Coverage"}
          </>
        }
        title="Coverage"
        description={description}
      >
        <ScoutCoverageLiveRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Opening Coverage">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
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
          title={copy.title}
          description={error ?? copy.description}
        >
          {setup ? (
            <Button as="a" variant="primary" href={setup.href}>
              {setup.label}
            </Button>
          ) : null}
          {shell === "empty" ? (
            <Button as="a" variant="primary" href={commandHref}>Sync event schedule</Button>
          ) : null}
        </EmptyState>
      )}
      {shell === "ready" ? <ScoutCoverageLiveNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function ScoutCoverageLiveClient({ orgId: initialOrgId }: { orgId?: string }) {
  const [view, setView] = useState<ScoutCoverageLiveView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [thresholdInput, setThresholdInput] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<ScoutCoverageLiveView | null>(null);
  viewRef.current = view;

  const orgId = (view && "orgId" in view ? view.orgId : null) ?? initialOrgId ?? null;

  const load = useCallback(() => {
    void (async () => {
      const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      const urlOrg = (initialOrgId ?? params.get("orgId"))?.trim() ?? "";
      const urlEvent = params.get("eventKey");
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<ScoutCoverageLiveView>(
          "scout-coverage-live",
          urlOrg || "_",
        );
        if (!viewRef.current && cached?.data && isScoutCoverageLiveView(cached.data)) {
          setView(cached.data);
          if (cached.data.status === "live") setThresholdInput(String(cached.data.thinThreshold));
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      setError("");
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      if (urlEvent) query.set("eventKey", urlEvent);
      try {
        const response = await fetch(
          `/api/scout-coverage-live${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as ScoutCoverageLiveView | { error?: string };
        if (!response.ok || !isScoutCoverageLiveView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Coverage. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
            setError("error" in data && data.error ? data.error : "Could not load scout coverage.");
          }
          return;
        }
        setView(data);
        if (data.status === "live") setThresholdInput(String(data.thinThreshold));
        setFromCache(false);
        setCachedAt(null);
        await persistScoutCoverageLiveSnapshot(urlOrg, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Coverage. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
          setError("Network error — please try again.");
        }
      }
    })();
  }, [initialOrgId]);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const eventKey = view && view.status === "live" ? view.eventKey : undefined;
        const response = await fetch("/api/scout-coverage-live", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, eventKey, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as ScoutCoverageLiveView | { error?: string };
        if (!response.ok || !isScoutCoverageLiveView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        if (data.status === "live") setThresholdInput(String(data.thinThreshold));
        void persistScoutCoverageLiveSnapshot(orgId, data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, view, busy],
  );

  const totalCells = view?.status === "live" ? view.summary.totalCells : 0;
  const gapCount = view?.status === "live" ? view.gaps.length : 0;
  const unackedNudges =
    view?.status === "live" ? view.nudges.filter((nudge) => !nudge.acknowledged).length : 0;

  const shell = classifyScoutCoverageLiveShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    totalCells,
  });
  const shellCopy = scoutCoverageLiveShellCopy(shell);
  const nextActions = scoutCoverageLiveNextActions({
    orgId,
    shell,
    gapCount,
    unackedNudges,
  });
  const competitionHref = hubHref("/competition", "scouting", orgId);
  const showTiles =
    view?.status === "live" &&
    shouldShowScoutCoverageLiveSummaryTiles({ totalCells: view.summary.totalCells });
  const loaded = view?.status === "live";

  if (shell === "loading") {
    return (
      <ScoutCoverageLiveShell description={shellCopy.description} orgId={orgId} shell="loading">
        <OfflineBanner feature="Coverage" fromCache={fromCache} cachedAt={cachedAt} />
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
        onRetry={() => load()}
      >
        <OfflineBanner feature="Coverage" fromCache={fromCache} cachedAt={cachedAt} />
      </ScoutCoverageLiveShell>
    );
  }
  if (shell === "setup") {
    return (
      <ScoutCoverageLiveShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Coverage" fromCache={fromCache} cachedAt={cachedAt} />
      </ScoutCoverageLiveShell>
    );
  }
  if (shell === "empty" || view?.status !== "live") {
    return (
      <ScoutCoverageLiveShell description={shellCopy.description} orgId={orgId} shell="empty">
        <OfflineBanner feature="Coverage" fromCache={fromCache} cachedAt={cachedAt} />
      </ScoutCoverageLiveShell>
    );
  }

  return (
    <main className="module-page scout-coverage-live-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Coverage"}
          </>
        }
        title="Coverage"
        description="Zero and thin match/team cells from real scout-entry counts, with coordinator nudges mid-event."
      >
        <div className="scout-coverage-live-header-meta">
          <ScoutCoverageLiveRelatedStrip orgId={orgId} />
        </div>
      </PageHeader>

      <OfflineBanner feature="Coverage" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="form-message" role="status">
          {error}
        </p>
      ) : null}

      <section className="scout-coverage-live-event" aria-label="Event and thin threshold">
        <div>
          <span className="app-muted">Event</span>
          <strong style={{ display: "block" }}>{view.eventKey}</strong>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = Number(thresholdInput);
            if (Number.isFinite(value) && value > 0) {
              void mutate({ action: "set-threshold", thinThreshold: Math.round(value) });
            }
          }}
        >
          <FormRow label="Thin threshold (entries)">
            <input
              type="number"
              min={1}
              value={thresholdInput}
              onChange={(event) => setThresholdInput(event.target.value)}
            />
          </FormRow>
          <Button variant="secondary" type="submit" disabled={busy}>
            Save threshold
          </Button>
        </form>
      </section>

      {showTiles ? <SummaryTiles view={view} loaded={loaded} /> : null}
      <CoverageGaps view={view} busy={busy} mutate={mutate} loaded={loaded} />
      <NudgeLog view={view} busy={busy} mutate={mutate} />
      <ScoutCoverageLiveNextActionsPanel actions={nextActions} />
      <p className="app-muted scout-coverage-live-footer-links">
        Also see{" "}
        <a href={hubHref("/competition", "scouting", orgId)}>Scouting</a>
        {" · "}
        <a href={withOrgHref("/scouting/lineup", orgId)}>Lineup</a>
        {" · "}
        <a href={withOrgHref("/scout-crossval", orgId)}>Cross-Validation</a>
      </p>
    </main>
  );
}

function SummaryTiles({ view, loaded }: { view: LiveView; loaded: boolean }) {
  const { summary } = view;
  const hasSchedule = summary.totalCells > 0;
  return (
    <section className="scout-coverage-live-kpis" aria-label="Coverage summary">
      <StatTile
        label="Schedule cells"
        value={formatScoutCoverageLiveMetric(summary.totalCells, loaded)}
        unit="match · team"
      />
      <StatTile
        label="No coverage"
        value={formatScoutCoverageLiveMetric(summary.zeroCount, loaded)}
        unit="zero entries"
      />
      <StatTile
        label="Thin"
        value={formatScoutCoverageLiveMetric(summary.thinCount, loaded)}
        unit="below threshold"
      />
      <StatTile
        label="Covered"
        value={formatScoutCoverageLiveRate(summary.coveragePct, loaded, { hasSchedule })}
        unit="real entry rate"
      />
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
  mutate: (payload: Record<string, unknown>) => void;
  loaded: boolean;
}) {
  return (
    <Panel className="scout-coverage-live-panel" id="coverage-gaps">
      <header>
        <h2>Coverage gaps</h2>
        <p className="app-muted">
          Zero and thin cells from real scout-entry counts. Nudge the coordinator mid-event.
        </p>
      </header>
      {view.gaps.length === 0 ? (
        <p className="app-muted">
          No zero or thin coverage right now — every scheduled team/match meets the threshold from real entries.
        </p>
      ) : (
        <ul className="scout-coverage-live-list">
          {view.gaps.map((cell) => (
            <li key={`${cell.matchKey}::${cell.teamKey}`}>
              <div>
                <div className="scout-coverage-live-row-meta">
                  <Badge tone={statusTone(cell.status)}>{statusLabel(cell.status)}</Badge>
                  <strong>
                    {cell.matchLabel} · Team {cell.teamNumber}
                  </strong>
                </div>
                <small>
                  {cell.alliance} alliance · {formatScoutCoverageLiveMetric(cell.entryCount, loaded)} entr
                  {cell.entryCount === 1 ? "y" : "ies"}
                </small>
              </div>
              <Button variant="secondary" type="button" disabled={busy} onClick={() => void mutate({ action: "send-nudge", matchKey: cell.matchKey, teamKey: cell.teamKey, message: `${cell.matchLabel}: Team ${cell.teamNumber} has ${cell.entryCount} scouting entr${cell.entryCount === 1 ? "y" : "ies"} — send a scout.`, }) }>
                Nudge coordinator
              </Button>
            </li>
          ))}
        </ul>
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
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel className="scout-coverage-live-panel" id="nudge-log">
      <header>
        <h2>Coordinator nudge log</h2>
        <p className="app-muted">Real nudges only — acknowledge once a scout is seated.</p>
      </header>
      {view.nudges.length === 0 ? (
        <p className="app-muted">No coverage nudges sent yet. Send one from the gaps above.</p>
      ) : (
        <ul className="scout-coverage-live-list">
          {view.nudges.map((nudge) => (
            <li key={nudge.id}>
              <div>
                <strong>
                  {nudge.matchLabel} · Team {nudge.teamNumber}
                </strong>
                <small>{nudge.message}</small>
                <small>
                  Sent {new Date(nudge.sentAt).toLocaleString()}
                  {nudge.acknowledged ? " · Acknowledged" : ""}
                </small>
              </div>
              {!nudge.acknowledged ? (
                <Button variant="secondary" type="button" disabled={busy} onClick={() => void mutate({ action: "acknowledge-nudge", nudgeId: nudge.id })}>
                  Acknowledge
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
