"use client";

import { EmptyState, Panel, Button } from "../../components/ui";
import type { OvernightIntelView } from "../../lib/overnight-intel/compute-overnight-intel";
import {
  formatOvernightIntelMetric,
  shouldShowOvernightIntelSummaryTiles,
} from "../../lib/overnight-intel/overnight-intel-related";

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

export function OvernightSummaryTiles({
  briefCount,
  signalCount,
}: {
  briefCount: number;
  signalCount: number;
}) {
  if (!shouldShowOvernightIntelSummaryTiles(briefCount, signalCount)) return null;
  return (
    <section className="overnight-intel-stats" aria-label="Overnight brief counts">
      <div>
        <strong>{formatOvernightIntelMetric(briefCount, true)}</strong>
        <span className="app-muted" style={{ display: "block" }}>
          Saved briefs
        </span>
      </div>
      <div>
        <strong>{formatOvernightIntelMetric(signalCount, true)}</strong>
        <span className="app-muted" style={{ display: "block" }}>
          Live changes
        </span>
      </div>
    </section>
  );
}

export function OvernightSummaryPanel({
  view,
  busy,
  onGenerate,
}: {
  view: LiveView;
  busy: boolean;
  onGenerate: () => void;
}) {
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
        <Button
          variant="primary"
          id="overnight-intel-generate"
          type="button"
          disabled={busy}
          onClick={onGenerate}
        >
          {busy ? "Saving…" : "Save tonight's brief"}
        </Button>
      </header>
      {view.latestBrief ? (
        <div style={{ marginTop: 12 }}>
          <span className="app-badge good">{view.latestBrief.briefDate}</span>
          <p style={{ marginTop: 8 }}>{view.latestBrief.summary}</p>
        </div>
      ) : (
        <p className="app-muted" style={{ marginTop: 12 }}>
          No brief saved yet. Live changes below are what moved since last night — save a brief to keep
          tonight&apos;s snapshot.
        </p>
      )}
    </Panel>
  );
}

export function OvernightResearchPanel({ view }: { view: LiveView }) {
  const { researchHighlights } = view.signals;
  if (researchHighlights.length === 0) {
    return (
      <EmptyState
        soft
        badge="No new notes"
        badgeTone="setup"
        title="No new public notes"
        description="Nothing new has shown up for teams at this event since the last brief."
      />
    );
  }
  return (
    <Panel className="overnight-intel-panel">
      <h2 style={{ marginTop: 0 }}>New public notes</h2>
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
              {item.sourceType.replaceAll("_", " ")} · {formatDateTime(item.foundAt)}
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

export function OvernightEpaPanel({ view }: { view: LiveView }) {
  const { epaMovers } = view.signals;
  if (epaMovers.length === 0) {
    return (
      <EmptyState
        soft
        badge="No score movement"
        badgeTone="setup"
        title="No material season-score movement"
        description="No team at this event moved enough on season rating since last night to report."
      />
    );
  }
  return (
    <Panel className="overnight-intel-panel">
      <h2 style={{ marginTop: 0 }}>Season-score movers</h2>
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

export function OvernightScoutingPanel({ view }: { view: LiveView }) {
  const { scoutingHighlights } = view.signals;
  if (scoutingHighlights.length === 0) {
    return (
      <EmptyState
        soft
        badge="No new scouting"
        badgeTone="setup"
        title="No new scouting entries"
        description="No new match scouting has been logged for this event since the last brief."
      />
    );
  }
  return (
    <Panel className="overnight-intel-panel">
      <h2 style={{ marginTop: 0 }}>New scouting</h2>
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

export function OvernightHistoryPanel({ view }: { view: LiveView }) {
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
