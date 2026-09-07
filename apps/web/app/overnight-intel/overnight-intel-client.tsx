"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import type { OvernightIntelView } from "../../lib/overnight-intel/compute-overnight-intel";
import {
  OVERNIGHT_INTEL_RELATED_INCLUDE,
  classifyOvernightIntelShell,
  formatOvernightIntelMetric,
  overnightIntelNextActions,
  overnightIntelRelatedLinks,
  overnightIntelShellCopy,
  overnightIntelSignalCount,
  shouldShowOvernightIntelSummaryTiles,
  type OvernightIntelNextAction,
  type OvernightIntelShellKind,
} from "../../lib/overnight-intel/overnight-intel-related";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./overnight-intel.css";

function formatDelta(delta: number | null): string {
  if (delta == null) return "—";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta}`;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

type LiveView = Extract<OvernightIntelView, { status: "live" }>;

function IntelRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = overnightIntelRelatedLinks(orgId, {
    include: [...OVERNIGHT_INTEL_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related overnight-intel-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function IntelNextActionsPanel({ actions }: { actions: OvernightIntelNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions overnight-intel-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Command, Strategy, and Scouting — never DEMO overnight digests.</p>
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

function IntelShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  needsActiveEvent,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: OvernightIntelShellKind;
  error?: string;
  onRetry?: () => void;
  needsActiveEvent?: boolean;
  children?: ReactNode;
}) {
  const actions = overnightIntelNextActions({ orgId, shell, needsActiveEvent });
  const copy = overnightIntelShellCopy(shell);
  const competitionHref = hubWorkbenchHref("competition", "overnight-intel", orgId);
  const commandHref = hubHref("/competition", "command", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);

  return (
    <main className="module-page overnight-intel-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Overnight Intel"}
          </>
        }
        title="Overnight Event-Intel Brief"
        description={description}
      >
        <IntelRelatedStrip orgId={orgId} />
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
                ? "No overnight changes yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          needsActiveEvent && orgId ? (
            <a className="app-button" href={withOrgHref("/team/data", orgId)}>
              Set active event
            </a>
          ) : (
            <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
              Open Workspace
            </a>
          )
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href="#overnight-intel-generate">
              Generate tonight&apos;s brief
            </a>
            <a className="app-button secondary" href={commandHref}>
              Open Command
            </a>
            <a className="app-button secondary" href={strategyHref}>
              Open Strategy
            </a>
          </>
        ) : null}
      </EmptyState>
      <IntelNextActionsPanel actions={actions} />
    </main>
  );
}

export default function OvernightIntelClient() {
  const [view, setView] = useState<OvernightIntelView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/overnight-intel${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as OvernightIntelView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const briefCount = view?.status === "live" ? view.briefs.length : 0;
  const signalCount =
    view?.status === "live" ? overnightIntelSignalCount(view.signals) : 0;
  const needsActiveEvent =
    view?.status === "setup_required" &&
    Boolean(view.orgId) &&
    view.steps.some((step) => step.id === "active-event");

  const shell = classifyOvernightIntelShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    briefCount,
    signalCount,
  });
  const shellCopy = overnightIntelShellCopy(shell);
  const nextActions = overnightIntelNextActions({
    orgId,
    shell,
    briefCount,
    signalCount,
    needsActiveEvent,
  });
  const relatedLinks = overnightIntelRelatedLinks(orgId, {
    include: [...OVERNIGHT_INTEL_RELATED_INCLUDE],
  });
  const competitionHref = hubWorkbenchHref("competition", "overnight-intel", orgId);
  const commandHref = hubHref("/competition", "command", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const scoutingHref = hubHref("/competition", "scouting", orgId);

  const generateBrief = useCallback(async () => {
    if (!orgId || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/overnight-intel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "generate-brief" }),
      });
      const data = (await response.json()) as OvernightIntelView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Something went wrong.");
        return;
      }
      setView(data);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }, [orgId, busy]);

  if (shell === "loading") {
    return <IntelShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <IntelShell
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
      <IntelShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
        needsActiveEvent={needsActiveEvent}
      >
        {view?.status === "setup_required" && view.steps.length > 0 ? (
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href} aria-label={step.label}>Open</a>
              </li>
            ))}
          </ol>
        ) : null}
      </IntelShell>
    );
  }

  if (view?.status !== "live") {
    return <IntelShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page overnight-intel-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Overnight Intel"}
          </>
        }
        title="Overnight Event-Intel Brief"
        description="A morning what-changed digest for your active event — newest research findings, EPA movement, and new scouting since the last brief. Empty sections mean no change was recorded — never DEMO overnight digests. Cross-check Command, Strategy, and Scouting."
      >
        <div className="overnight-intel-header-actions">
          <button
            id="overnight-intel-generate"
            type="button"
            className="app-button"
            disabled={busy}
            onClick={() => void generateBrief()}
          >
            {busy ? "Generating…" : "Generate tonight's brief"}
          </button>
          {relatedLinks.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <IntelNextActionsPanel actions={nextActions} />

      {shouldShowOvernightIntelSummaryTiles(briefCount, signalCount) ? (
        <section className="overnight-intel-stats" aria-label="Overnight Intel counts">
          <div>
            <strong>{formatOvernightIntelMetric(briefCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Saved briefs
            </span>
          </div>
          <div>
            <strong>{formatOvernightIntelMetric(signalCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Live signals
            </span>
          </div>
        </section>
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No overnight changes yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <button type="button" className="app-button" disabled={busy} onClick={() => void generateBrief()}>
            {busy ? "Generating…" : "Generate tonight's brief"}
          </button>
          <a className="app-button secondary" href={commandHref}>
            Open Command
          </a>
          <a className="app-button secondary" href={scoutingHref}>
            Open Scouting
          </a>
        </EmptyState>
      ) : null}

      <div className="overnight-intel-layout">
        <SummaryPanel view={view} />
        {shell === "ready" ? (
          <>
            <ResearchPanel view={view} />
            <EpaPanel view={view} />
            <ScoutingPanel view={view} />
            <HistoryPanel view={view} />
          </>
        ) : null}
        <Panel className="overnight-intel-tip" aria-label="Overnight Intel tip">
          <span className="eyebrow">Grounding path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Carry overnight moves into <a href={commandHref}>Command</a> and{" "}
            <a href={strategyHref}>Strategy</a>, and keep logging in <a href={scoutingHref}>Scouting</a> —
            never invent DEMO digests.
          </p>
        </Panel>
      </div>
    </main>
  );
}

function SummaryPanel({ view }: { view: LiveView }) {
  return (
    <Panel id="overnight-intel-summary" className="overnight-intel-panel" aria-label="Latest overnight brief">
      <header>
        <div>
          <h2 style={{ margin: 0 }}>{view.eventName}</h2>
          <small className="app-muted">
            {view.seasonYear} · {view.teamNumber != null ? `Team ${view.teamNumber} · ` : ""}
            Last computed {formatDateTime(view.computedAt)}
          </small>
        </div>
      </header>
      {view.latestBrief ? (
        <div style={{ marginTop: 12 }}>
          <span className="app-badge good">{view.latestBrief.briefDate}</span>
          <p style={{ marginTop: 8 }}>{view.latestBrief.summary}</p>
        </div>
      ) : (
        <p className="app-muted" style={{ marginTop: 12 }}>
          No brief has been generated yet. Live signals below reflect what changed since your last
          check-in — generate a brief to save tonight&apos;s snapshot. Never invent DEMO digests.
        </p>
      )}
    </Panel>
  );
}

function ResearchPanel({ view }: { view: LiveView }) {
  const { researchHighlights } = view.signals;
  if (researchHighlights.length === 0) {
    return (
      <EmptyState
        soft
        badge="No new research"
        badgeTone="setup"
        title="No new research findings"
        description="Nothing new has surfaced from Intel/Research for teams at this event since the last brief — never DEMO findings."
      />
    );
  }
  return (
    <Panel className="overnight-intel-panel">
      <h2 style={{ marginTop: 0 }}>New research findings</h2>
      <ul className="overnight-intel-list">
        {researchHighlights.map((item, index) => (
          <li key={`${item.teamKey}-${index}`}>
            <strong>
              {item.teamNumber != null ? `Team ${item.teamNumber}` : item.teamKey} — {item.title}
            </strong>
            <p className="app-muted" style={{ margin: "4px 0" }}>
              {item.summary}
            </p>
            <small className="app-muted">
              {item.sourceType} · {formatDateTime(item.foundAt)}
              {item.sourceUrl ? (
                <>
                  {" · "}
                  <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                    Source
                  </a>
                </>
              ) : null}
            </small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function EpaPanel({ view }: { view: LiveView }) {
  const { epaMovers } = view.signals;
  if (epaMovers.length === 0) {
    return (
      <EmptyState
        soft
        badge="No EPA movement"
        badgeTone="setup"
        title="No material EPA movement"
        description="No team at this event moved enough on EPA since the last snapshot to report — never DEMO EPA swings."
      />
    );
  }
  return (
    <Panel className="overnight-intel-panel">
      <h2 style={{ marginTop: 0 }}>EPA movers</h2>
      <ul className="overnight-intel-list">
        {epaMovers.map((mover) => (
          <li key={mover.teamKey} className="overnight-intel-row">
            <span>{mover.teamNumber != null ? `Team ${mover.teamNumber}` : mover.teamKey}</span>
            <small className="app-muted">
              {mover.previousEpa ?? "—"} → {mover.currentEpa} ({formatDelta(mover.deltaEpa)})
            </small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ScoutingPanel({ view }: { view: LiveView }) {
  const { scoutingHighlights } = view.signals;
  if (scoutingHighlights.length === 0) {
    return (
      <EmptyState
        soft
        badge="No new scouting"
        badgeTone="setup"
        title="No new scouting entries"
        description="No new match scouting has been logged for this event since the last brief — never DEMO scout counts."
      />
    );
  }
  return (
    <Panel className="overnight-intel-panel">
      <h2 style={{ marginTop: 0 }}>New scouting activity</h2>
      <ul className="overnight-intel-list">
        {scoutingHighlights.map((item) => (
          <li key={item.teamKey} className="overnight-intel-row">
            <span>{item.teamNumber != null ? `Team ${item.teamNumber}` : item.teamKey}</span>
            <small className="app-muted">
              {item.newEntries} new entr{item.newEntries === 1 ? "y" : "ies"} · last{" "}
              {formatDateTime(item.lastScoutedAt)}
            </small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function HistoryPanel({ view }: { view: LiveView }) {
  if (view.briefs.length === 0) return null;
  return (
    <Panel className="overnight-intel-panel">
      <h2 style={{ marginTop: 0 }}>Brief history</h2>
      <ul className="overnight-intel-list">
        {view.briefs.map((brief) => (
          <li key={brief.id}>
            <strong>{brief.briefDate}</strong>
            <p className="app-muted" style={{ margin: "4px 0" }}>
              {brief.summary}
            </p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
