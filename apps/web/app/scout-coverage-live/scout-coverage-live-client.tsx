"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Badge,
  type BadgeTone,
  EmptyState,
  ErrorState,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
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

function ScoutCoverageLiveRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = scoutCoverageLiveRelatedLinks(orgId, {
    include: [...SCOUT_COVERAGE_LIVE_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related scout-coverage-live-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
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
        <p className="app-muted">Scouting, Lineup, and Cross-Validation — never DEMO coverage.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
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
  const steps = shell === "setup" ? scoutCoverageLiveSetupSteps(orgId) : [];
  const scoutingHref = hubHref("/competition", "scouting", orgId);
  const lineupHref = withOrgHref("/scouting/lineup", orgId);
  const crossvalHref = withOrgHref("/scout-crossval", orgId);
  const commandHref = hubHref("/competition", "command", orgId);

  return (
    <main className="module-page scout-coverage-live-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Scout Coverage Live"}
          </>
        }
        title="Scout Coverage Live"
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
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={
            shell === "setup"
              ? "Setup required"
              : shell === "empty"
                ? "No schedule yet"
                : copy.badge
          }
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
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
              <a className="app-button secondary" href={lineupHref}>
                Open Lineup
              </a>
              <a className="app-button secondary" href={crossvalHref}>
                Open Cross-Validation
              </a>
            </>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="scout-coverage-live-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Scouting, Lineup, and Cross-Validation — never DEMO coverage.</p>
          </header>
          <ul className="scout-coverage-live-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted scout-coverage-live-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <ScoutCoverageLiveNextActionsPanel actions={actions} />
    </main>
  );
}

export default function ScoutCoverageLiveClient({ orgId: initialOrgId }: { orgId?: string }) {
  const [view, setView] = useState<ScoutCoverageLiveView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [thresholdInput, setThresholdInput] = useState("");

  const orgId = (view && "orgId" in view ? view.orgId : null) ?? initialOrgId ?? null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const urlOrg = initialOrgId ?? params.get("orgId");
    const urlEvent = params.get("eventKey");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (urlEvent) query.set("eventKey", urlEvent);
    void fetch(`/api/scout-coverage-live${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ScoutCoverageLiveView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          setError("error" in data && data.error ? data.error : "Could not load scout coverage.");
          return;
        }
        setView(data);
        if (data.status === "live") setThresholdInput(String(data.thinThreshold));
      })
      .catch(() => {
        setFetchFailed(true);
        setError("Network error — please try again.");
      });
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
        });
        const data = (await response.json()) as ScoutCoverageLiveView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        if (data.status === "live") setThresholdInput(String(data.thinThreshold));
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
    return <ScoutCoverageLiveShell description={shellCopy.description} orgId={orgId} shell="loading" />;
  }
  if (shell === "error") {
    return (
      <ScoutCoverageLiveShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }
  if (shell === "setup") {
    return (
      <ScoutCoverageLiveShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }
  if (shell === "empty" || view?.status !== "live") {
    return <ScoutCoverageLiveShell description={shellCopy.description} orgId={orgId} shell="empty" />;
  }

  return (
    <main className="module-page scout-coverage-live-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Scout Coverage Live"}
          </>
        }
        title="Scout Coverage Live"
        description="Zero and thin match/team cells from real scout-entry counts, with coordinator nudges mid-event — never DEMO coverage."
      >
        <div className="scout-coverage-live-header-meta">
          <ScoutCoverageLiveRelatedStrip orgId={orgId} />
        </div>
      </PageHeader>

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
          <button type="submit" className="app-button secondary" disabled={busy}>
            Save threshold
          </button>
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
          Zero and thin cells from real scout-entry counts — never DEMO gaps. Nudge the coordinator mid-event.
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
              <button
                type="button"
                className="app-button secondary"
                disabled={busy}
                onClick={() =>
                  void mutate({
                    action: "send-nudge",
                    matchKey: cell.matchKey,
                    teamKey: cell.teamKey,
                    message: `${cell.matchLabel}: Team ${cell.teamNumber} has ${cell.entryCount} scouting entr${cell.entryCount === 1 ? "y" : "ies"} — send a scout.`,
                  })
                }
              >
                Nudge coordinator
              </button>
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
                <button
                  type="button"
                  className="app-button secondary"
                  disabled={busy}
                  onClick={() => void mutate({ action: "acknowledge-nudge", nudgeId: nudge.id })}
                >
                  Acknowledge
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
