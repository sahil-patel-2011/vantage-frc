"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
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
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./match-copilot.css";

function isMatchCopilotView(value: unknown): value is MatchCopilotView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistMatchCopilotSnapshot(orgHint: string, data: MatchCopilotView): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("match-copilot", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("match-copilot", "_", data);
  } catch {
    // Live brief already painted; IndexedDB is best-effort.
  }
}

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
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
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
  const competitionHref = hubWorkbenchHref("competition", "match-copilot", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);

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
            ? "Needs setup"
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
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {shell === "setup" ? (
          <Button as="a" variant="primary" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>Choose your team</Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href={strategyHref}>Open Strategy</Button>
        ) : null}
      </EmptyState>
      {shell === "ready" ? <CopilotNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function MatchCopilotClient() {
  const [view, setView] = useState<MatchCopilotView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<MatchCopilotView | null>(null);
  viewRef.current = view;

  const load = useCallback(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<MatchCopilotView>("match-copilot", urlOrg || "_");
        if (!viewRef.current && cached?.data && isMatchCopilotView(cached.data)) {
          setView(cached.data);
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
      try {
        const response = await fetch(
          `/api/match-copilot${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as MatchCopilotView | { error?: string };
        if (!response.ok || !isMatchCopilotView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Match Copilot. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistMatchCopilotSnapshot(urlOrg, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Match Copilot. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
        }
      }
    })();
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
  const competitionHref = hubWorkbenchHref("competition", "match-copilot", orgId);
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
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as MatchCopilotView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Something went wrong.");
        return;
      }
      setView(data);
      void persistMatchCopilotSnapshot(orgId, data);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }, [orgId, busy]);

  if (shell === "loading") {
    return (
      <CopilotShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Match Copilot" fromCache={fromCache} cachedAt={cachedAt} />
      </CopilotShell>
    );
  }

  if (shell === "error") {
    return (
      <CopilotShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Match Copilot" fromCache={fromCache} cachedAt={cachedAt} />
      </CopilotShell>
    );
  }

  if (shell === "setup") {
    return (
      <CopilotShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Match Copilot" fromCache={fromCache} cachedAt={cachedAt} />
      </CopilotShell>
    );
  }

  if (view?.status !== "live") {
    return (
      <CopilotShell description={shellCopy.description} orgId={orgId} shell="setup">
        <OfflineBanner feature="Match Copilot" fromCache={fromCache} cachedAt={cachedAt} />
      </CopilotShell>
    );
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
        description="A glanceable 60-second brief for your next match — fusing opponent rating, your stored strategy plan, open FMEA risks, and live battery health into prioritized do-this callouts. Cross-check Strategy, Command, and FMEA."
      >
        <div className="match-copilot-header-actions">
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>

      <OfflineBanner feature="Match Copilot" fromCache={fromCache} cachedAt={cachedAt} />

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
          <Button as="a" variant="primary" href={strategyHref}>
            Open Strategy
          </Button>
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
            in <a href={commandHref}>Command</a>, and log open failures in <a href={fmeaHref}>FMEA</a>
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
            {view.scheduledTime ? new Date(view.scheduledTime).toLocaleString() : "Time TBD"} · Our rating{" "}
            {epaLabel(view.ourEpaTotal)}
          </small>
        </div>
        <Button variant="primary" type="button" disabled={busy} onClick={onGenerate}>
          {busy ? "Generating…" : view.generatedBy === "ai" ? "Regenerate brief" : "Generate brief"}
        </Button>
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
        description="Fuses opponent rating, your strategy plan, open FMEA risks, and battery health into up to 3 prioritized callouts."
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
        <p className="app-muted">No opponent data available yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8, margin: 0 }}>
          {view.opponents.map((team) => (
            <li key={team.teamKey} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{team.nickname ? `${team.nickname} (#${team.teamNumber})` : `Team ${team.teamNumber}`}</span>
              <small className="app-muted">Rating {epaLabel(team.epaTotal)}</small>
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
        <p className="app-muted">No open risks logged.</p>
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
        <p className="app-muted">No batteries tracked.</p>
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
