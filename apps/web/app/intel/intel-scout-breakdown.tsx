"use client";

import { useState } from "react";
import { Panel } from "../../components/ui";
import type { FieldBreakdown, NumericBreakdown, ScoutBreakdown } from "../../lib/scouting/scout-breakdown";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function Trend({ delta, lowerIsBetter }: { delta: number | null; lowerIsBetter: boolean }) {
  if (delta == null || Math.abs(delta) < 0.5) return null;
  const up = delta > 0;
  const good = lowerIsBetter ? !up : up;
  return (
    <small className={`intel-vs ${good ? "intel-vs-above" : "intel-vs-below"}`}>
      {up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)} last 3 matches
    </small>
  );
}

/**
 * One bar per match, tallest = best match. The numbers are underneath in a
 * list, so the chart is never the only way to read a value.
 */
function MatchBars({ field }: { field: NumericBreakdown }) {
  const max = Math.max(1, field.max);
  return (
    <div className="intel-sb-detail">
      <div className="intel-sb-bars" aria-hidden="true">
        {field.series.map((point, index) => (
          <span key={`${point.match}-${index}`} style={{ height: `${Math.max(4, (point.value / max) * 100)}%` }} />
        ))}
      </div>
      <ol className="intel-sb-series" aria-label={`${field.label} by match`}>
        {field.series.map((point, index) => (
          <li key={`${point.match}-${index}`}>
            <span>{point.match}</span>
            <strong>{point.value}</strong>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Tile({ field, open, onToggle }: { field: FieldBreakdown; open: boolean; onToggle: () => void }) {
  if (field.kind === "number") {
    return (
      <Panel className={`intel-sb-tile${open ? " is-open" : ""}`} style={{ minHeight: "auto" }}>
        <button type="button" className="intel-sb-head" aria-expanded={open} onClick={onToggle}>
          <span className="app-muted">{field.label}</span>
          <strong>{field.mean}</strong>
          <small className="app-muted">
            avg · {field.min}–{field.max} over {field.series.length}
          </small>
          <Trend delta={field.recentDelta} lowerIsBetter={field.lowerIsBetter} />
          {field.sparkline ? (
            <svg className="intel-spark" viewBox="0 0 72 28" aria-hidden="true">
              <path d={field.sparkline} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          ) : null}
        </button>
        {open ? <MatchBars field={field} /> : null}
      </Panel>
    );
  }
  if (field.kind === "rate") {
    const bad = field.yesIsBad && field.yes > 0;
    return (
      <Panel className="intel-sb-tile" style={{ minHeight: "auto" }}>
        <div className="intel-sb-head">
          <span className="app-muted">{field.label}</span>
          <strong className={bad ? "intel-vs-below" : undefined}>{pct(field.rate)}</strong>
          <small className="app-muted">
            yes in {field.yes} of {field.total}
          </small>
          <span className="intel-sb-meter" aria-hidden="true">
            <i className={bad ? "is-bad" : undefined} style={{ width: pct(field.rate) }} />
          </span>
        </div>
      </Panel>
    );
  }
  return (
    <Panel className="intel-sb-tile" style={{ minHeight: "auto" }}>
      <div className="intel-sb-head">
        <span className="app-muted">{field.label}</span>
        <strong>{field.options[0]?.value ?? "—"}</strong>
        <small className="app-muted">most often, of {field.total}</small>
        <ul className="intel-sb-split">
          {field.options.map((option) => (
            <li key={option.value}>
              <span>{option.value}</span>
              <span className="intel-sb-meter" aria-hidden="true">
                <i style={{ width: pct(option.share) }} />
              </span>
              <b>{option.count}</b>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

export function IntelScoutBreakdown({ breakdown }: { breakdown: ScoutBreakdown }) {
  const [open, setOpen] = useState<string | null>(null);
  if (breakdown.fields.length === 0 && breakdown.notes.length === 0) {
    return (
      <section className="intel-lookup-board" aria-label="From our scouting">
        <header>
          <h3>From our scouting</h3>
          <p className="app-muted">No match scouting on this team yet. Scout a match and it shows up here.</p>
        </header>
      </section>
    );
  }
  return (
    <section className="intel-lookup-board" aria-label="From our scouting">
      <header>
        <h3>From our scouting</h3>
        <p className="app-muted">
          {breakdown.matches} match{breakdown.matches === 1 ? "" : "es"} scouted by our team. Tap a number to see it
          match by match.
        </p>
      </header>
      <div className="intel-lookup-grid">
        {breakdown.fields.map((field) => (
          <Tile
            key={field.key}
            field={field}
            open={open === field.key}
            onToggle={() => setOpen((current) => (current === field.key ? null : field.key))}
          />
        ))}
      </div>
      {breakdown.notes.length ? (
        <ul className="intel-sb-notes" aria-label="Scout notes">
          {breakdown.notes.map((note, index) => (
            <li key={`${note.match}-${index}`}>
              <span className="app-badge">{note.match}</span>
              <p>{note.text}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
