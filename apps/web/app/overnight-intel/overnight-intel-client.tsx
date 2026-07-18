"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import type { OvernightIntelView } from "../../lib/overnight-intel/compute-overnight-intel";

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

export default function OvernightIntelClient() {
  const [view, setView] = useState<OvernightIntelView | null>(null);
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

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Overnight Intel"}
          </>
        }
        title="Overnight Event-Intel Brief"
        description="A morning what-changed digest for your active event — newest research findings, EPA movement, and new scouting since the last brief. Nothing here is invented; empty sections mean no change was recorded."
      >
        {orgId && view?.status === "live" ? (
          <button type="button" className="app-button" disabled={busy} onClick={() => void generateBrief()}>
            {busy ? "Generating…" : "Generate tonight's brief"}
          </button>
        ) : null}
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load the overnight intel brief"
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
          <SummaryPanel view={view} />
          <ResearchPanel view={view} />
          <EpaPanel view={view} />
          <ScoutingPanel view={view} />
          <HistoryPanel view={view} />
        </div>
      )}
    </main>
  );
}

function SummaryPanel({ view }: { view: LiveView }) {
  return (
    <Panel aria-label="Latest overnight brief">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
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
          No brief has been generated yet. The live signals below reflect what has changed since your last
          check-in — generate a brief to save tonight's snapshot.
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
        badge="No new research"
        badgeTone="setup"
        title="No new research findings"
        description="Nothing new has surfaced from Intel/Research for teams at this event since the last brief."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>New research findings</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
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
        badge="No EPA movement"
        badgeTone="setup"
        title="No material EPA movement"
        description="No team at this event moved enough on EPA since the last snapshot to report."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>EPA movers</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {epaMovers.map((mover) => (
          <li
            key={mover.teamKey}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}
          >
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
        badge="No new scouting"
        badgeTone="setup"
        title="No new scouting entries"
        description="No new match scouting has been logged for this event since the last brief."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>New scouting activity</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {scoutingHighlights.map((item) => (
          <li
            key={item.teamKey}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}
          >
            <span>{item.teamNumber != null ? `Team ${item.teamNumber}` : item.teamKey}</span>
            <small className="app-muted">
              {item.newEntries} new entr{item.newEntries === 1 ? "y" : "ies"} · last {formatDateTime(item.lastScoutedAt)}
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
    <Panel>
      <h2 style={{ marginTop: 0 }}>Brief history</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
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
