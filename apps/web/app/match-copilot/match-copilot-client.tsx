"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import type { MatchCopilotView } from "../../lib/match-copilot/compute-match-copilot";
import type { MatchCopilotCalloutCategory } from "../../lib/match-copilot/types";

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

export default function MatchCopilotClient() {
  const [view, setView] = useState<MatchCopilotView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

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

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/strategy?orgId=${encodeURIComponent(orgId)}` : "/strategy"}>Competition</a>
            {" / Match Copilot"}
          </>
        }
        title="Match Copilot"
        description="A glanceable 60-second brief for your next match — fusing opponent scouting/EPA, your stored strategy plan, open FMEA risks, and live battery fleet health into prioritized do-this callouts."
      >
        {orgId ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <a className="app-button secondary" href={`/strategy?orgId=${encodeURIComponent(orgId)}`}>
              Strategy
            </a>
            <a className="app-button secondary" href={`/command?orgId=${encodeURIComponent(orgId)}`}>
              Event Day Command
            </a>
          </div>
        ) : null}
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load Match Copilot"
          description="A network or server issue prevented loading. Try again."
        >
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
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
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <MatchHeaderPanel view={view} busy={busy} onGenerate={generateBrief} />
          <CalloutsPanel view={view} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
            <OpponentsPanel view={view} />
            <RisksPanel view={view} />
            <BatteryPanel view={view} />
          </div>
        </div>
      )}
    </main>
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
        badge="No callouts yet"
        badgeTone="setup"
        title="Generate this match's brief"
        description="Fuses opponent EPA, your strategy plan, open FMEA risks, and battery health into up to 3 prioritized callouts."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Do this next ({view.generatedBy === "ai" ? "generated" : "preview"})</h2>
      <ol style={{ listStyle: "none", padding: 0, display: "grid", gap: 12, margin: 0 }}>
        {view.callouts.map((callout) => (
          <li
            key={`${callout.priority}-${callout.category}-${callout.headline}`}
            style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
          >
            <strong style={{ fontSize: "1.4rem", minWidth: 28 }}>{callout.priority}</strong>
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
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
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
        <p className="app-muted">No open risks logged.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
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
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
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
