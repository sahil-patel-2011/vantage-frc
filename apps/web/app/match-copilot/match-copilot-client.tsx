"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import type { MatchCopilotView } from "../../lib/match-copilot/compute-match-copilot";
import {
  MATCH_COPILOT_RELATED_INCLUDE,
  classifyMatchCopilotShell,
  formatMatchCopilotMetric,
  matchCopilotNextActions,
  matchCopilotRelatedLinks,
  matchCopilotShellCopy,
  shouldShowMatchCopilotSummaryTiles,
  type MatchCopilotNextAction,
  type MatchCopilotShellKind,
} from "../../lib/match-copilot/match-copilot-related";
import type { MatchCopilotCalloutCategory } from "../../lib/match-copilot/types";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./match-copilot.css";

const CATEGORY_LABEL: Record<MatchCopilotCalloutCategory, string> = {
  opponent: "Opponent",
  strategy: "Strategy",
  risk: "FMEA risk",
  battery: "Battery",
};

const BATTERY_FLAG_TONE: Record<string, string> = {
  healthy: "good",
  watch: "setup",
  critical: "demo",
};

type LiveView = Extract<MatchCopilotView, { status: "live" }>;

function epaLabel(value: number | null): string {
  return value == null ? "—" : value.toFixed(1);
}

function CopilotRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = matchCopilotRelatedLinks(orgId, {
    include: [...MATCH_COPILOT_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related match-copilot-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function CopilotNextActionsPanel({ actions }: { actions: MatchCopilotNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions match-copilot-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Strategy, Command, and FMEA — never DEMO match metrics.</p>
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

function CopilotShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: MatchCopilotShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = matchCopilotNextActions({ orgId, shell });
  const copy = matchCopilotShellCopy(shell);
  const competitionHref = hubHref("/competition", "match-copilot", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const commandHref = hubHref("/competition", "command", orgId);
  const fmeaHref = hubHref("/team", "fmea", orgId);

  return (
    <main className="module-page match-copilot-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Match Copilot"}
          </>
        }
        title="Match Copilot"
        description={description}
      >
        <CopilotRelatedStrip orgId={orgId} />
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
                ? "No callouts yet"
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
          <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
            Open Workspace
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href={strategyHref}>
              Open Strategy
            </a>
            <a className="app-button secondary" href={commandHref}>
              Open Command
            </a>
            <a className="app-button secondary" href={fmeaHref}>
              Open FMEA
            </a>
          </>
        ) : null}
      </EmptyState>
      <CopilotNextActionsPanel actions={actions} />
    </main>
  );
}

export default function MatchCopilotClient() {
  const [view, setView] = useState<MatchCopilotView | null>(null);
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
    void fetch(`/api/match-copilot${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as MatchCopilotView | { error?: string };
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
  const calloutCount = view?.status === "live" ? view.callouts.length : 0;
  const opponentCount = view?.status === "live" ? view.opponents.length : 0;
  const openRiskCount = view?.status === "live" ? view.openRisks.length : 0;
  const batteryCount = view?.status === "live" ? view.batteryFleet.length : 0;
  const hasAiBrief = view?.status === "live" ? view.generatedBy === "ai" : false;

  const shell = classifyMatchCopilotShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    calloutCount,
  });
  const shellCopy = matchCopilotShellCopy(shell);
  const nextActions = matchCopilotNextActions({
    orgId,
    shell,
    calloutCount,
    hasAiBrief,
  });
  const relatedLinks = matchCopilotRelatedLinks(orgId, {
    include: [...MATCH_COPILOT_RELATED_INCLUDE],
  });
  const competitionHref = hubHref("/competition", "match-copilot", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const commandHref = hubHref("/competition", "command", orgId);
  const fmeaHref = hubHref("/team", "fmea", orgId);

  const generateBrief = useCallback(async () => {
    if (!orgId || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/match-copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "generate-brief" }),
      });
      const data = (await response.json()) as MatchCopilotView | { error?: string };
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
    return <CopilotShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <CopilotShell
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
      <CopilotShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        {view?.status === "setup_required" && view.steps.length > 0 ? (
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        ) : null}
      </CopilotShell>
    );
  }

  if (view?.status !== "live") {
    return <CopilotShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page match-copilot-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Match Copilot"}
          </>
        }
        title="Match Copilot"
        description="A glanceable 60-second brief for your next match — fusing opponent EPA, your stored strategy plan, open FMEA risks, and live battery health into prioritized do-this callouts. Never DEMO match metrics. Cross-check Strategy, Command, and FMEA."
      >
        <div className="match-copilot-header-actions">
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

      <CopilotNextActionsPanel actions={nextActions} />

      {shouldShowMatchCopilotSummaryTiles(calloutCount) ? (
        <SummaryTiles
          calloutCount={calloutCount}
          opponentCount={opponentCount}
          openRiskCount={openRiskCount}
          batteryCount={batteryCount}
          loaded
        />
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No callouts yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <a className="app-button" href={strategyHref}>
            Open Strategy
          </a>
          <a className="app-button secondary" href={commandHref}>
            Open Command
          </a>
          <a className="app-button secondary" href={fmeaHref}>
            Open FMEA
          </a>
        </EmptyState>
      ) : null}

      <div className="match-copilot-layout">
        <MatchHeaderPanel view={view} busy={busy} onGenerate={generateBrief} />
        <CalloutsPanel view={view} />
        <div className="match-copilot-panels">
          <OpponentsPanel view={view} />
          <RisksPanel view={view} />
          <BatteryPanel view={view} />
        </div>
        <Panel className="match-copilot-tip" aria-label="Match Copilot tip">
          <span className="eyebrow">Grounding path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Keep the next-match plan in <a href={strategyHref}>Strategy</a>, confirm the active event
            in <a href={commandHref}>Command</a>, and log open failures in <a href={fmeaHref}>FMEA</a> —
            never invent DEMO callouts, EPA, or battery flags.
          </p>
        </Panel>
      </div>
    </main>
  );
}

function SummaryTiles({
  calloutCount,
  opponentCount,
  openRiskCount,
  batteryCount,
  loaded,
}: {
  calloutCount: number;
  opponentCount: number;
  openRiskCount: number;
  batteryCount: number;
  loaded: boolean;
}) {
  const tiles = [
    { label: "Callouts", value: formatMatchCopilotMetric(calloutCount, loaded) },
    { label: "Opponents", value: formatMatchCopilotMetric(opponentCount, loaded) },
    { label: "Open FMEA risks", value: formatMatchCopilotMetric(openRiskCount, loaded) },
    { label: "Batteries tracked", value: formatMatchCopilotMetric(batteryCount, loaded) },
  ];
  return (
    <section className="match-copilot-stats" aria-label="Match Copilot counts">
      {tiles.map((tile) => (
        <div key={tile.label}>
          <strong>{tile.value}</strong>
          <span className="app-muted" style={{ display: "block" }}>
            {tile.label}
          </span>
        </div>
      ))}
    </section>
  );
}

function MatchHeaderPanel({
  view,
  busy,
  onGenerate,
}: {
  view: LiveView;
  busy: boolean;
  onGenerate: () => void;
}) {
  return (
    <Panel aria-label="Next match">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <span className="app-badge">{view.alliance.toUpperCase()} ALLIANCE</span>
          <h2 style={{ margin: "6px 0 0" }}>
            {view.compLevel.toUpperCase()} {view.matchNumber} · {view.eventName ?? view.eventKey}
          </h2>
          <small className="app-muted">
            {view.scheduledTime ? new Date(view.scheduledTime).toLocaleString() : "Time TBD"} · Our EPA{" "}
            {epaLabel(view.ourEpaTotal)}
          </small>
        </div>
        <button type="button" className="app-button" disabled={busy} onClick={onGenerate}>
          {busy ? "Generating…" : view.generatedBy === "ai" ? "Regenerate brief" : "Generate brief"}
        </button>
      </header>
    </Panel>
  );
}

function CalloutsPanel({ view }: { view: LiveView }) {
  if (view.callouts.length === 0) {
    return (
      <EmptyState
        soft
        badge="No callouts yet"
        badgeTone="setup"
        title="Generate this match's brief"
        description="Fuses opponent EPA, your strategy plan, open FMEA risks, and battery health into up to 3 prioritized callouts — never DEMO match metrics."
      />
    );
  }
  return (
    <Panel id="match-copilot-callouts">
      <h2 style={{ marginTop: 0 }}>Do this next ({view.generatedBy === "ai" ? "generated" : "preview"})</h2>
      <ol className="match-copilot-callouts">
        {view.callouts.map((callout) => (
          <li
            key={`${callout.priority}-${callout.category}-${callout.headline}`}
            className="match-copilot-callout"
          >
            <strong className="match-copilot-callout-priority">{callout.priority}</strong>
            <div>
              <span className="app-badge">{CATEGORY_LABEL[callout.category]}</span>
              <div style={{ fontWeight: 600, marginTop: 4 }}>{callout.headline}</div>
              <small className="app-muted">{callout.detail}</small>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function OpponentsPanel({ view }: { view: LiveView }) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Opponent alliance</h2>
      {view.opponents.length === 0 ? (
        <p className="app-muted">No opponent data available yet — never invent DEMO EPA.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8, margin: 0 }}>
          {view.opponents.map((team) => (
            <li key={team.teamKey} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{team.nickname ? `${team.nickname} (#${team.teamNumber})` : `Team ${team.teamNumber}`}</span>
              <small className="app-muted">EPA {epaLabel(team.epaTotal)}</small>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RisksPanel({ view }: { view: LiveView }) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Open FMEA risks</h2>
      {view.openRisks.length === 0 ? (
        <p className="app-muted">No open risks logged — never invent DEMO RPNs.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8, margin: 0 }}>
          {view.openRisks.map((risk) => (
            <li key={risk.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>{risk.title}</span>
                <small className="app-muted">RPN {risk.rpn}</small>
              </div>
              <small className="app-muted">{risk.subsystemName}</small>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function BatteryPanel({ view }: { view: LiveView }) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Battery fleet</h2>
      {view.batteryFleet.length === 0 ? (
        <p className="app-muted">No batteries tracked — never invent DEMO health flags.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8, margin: 0 }}>
          {view.batteryFleet.slice(0, 8).map((battery) => (
            <li key={battery.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{battery.label}</span>
              <span className={`app-badge ${BATTERY_FLAG_TONE[battery.flag] ?? ""}`}>{battery.flag}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
