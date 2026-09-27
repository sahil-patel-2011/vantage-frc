"use client";

import { useId, useState } from "react";
import { Panel } from "../../components/ui";
import type {
  FieldBreakdown,
  ScoutBreakdown,
} from "../../lib/scouting/scout-breakdown";

function answer(value: unknown): string {
  if (value === null || value === undefined || value === "")
    return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number")
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  return typeof value === "string" ? value : JSON.stringify(value);
}

function MetricTile({ field }: { field: FieldBreakdown }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const evidence = field.evidence;
  const summary =
    field.kind === "number"
      ? field.mean
      : field.kind === "rate"
        ? Math.round(field.rate * 100) + "%"
        : (field.options[0]?.value ?? "—");
  return (
    <Panel
      className={"intel-sb-tile" + (open ? " is-expanded" : "")}
      style={{ minHeight: "auto" }}
    >
      <button
        type="button"
        className="intel-sb-head"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{field.label}</span>
        <strong>
          {summary} {evidence.unit ? <small>{evidence.unit}</small> : null}
        </strong>
        <small className="app-muted">
          {field.kind === "number"
            ? "Average"
            : field.kind === "rate"
              ? "Recorded yes"
              : "Most common"}{" "}
          · {evidence.answered} matches
          {evidence.missing ? " · " + evidence.missing + " unanswered" : ""}
        </small>
        {evidence.disagreements ? (
          <span className="intel-evidence-warning">
            {evidence.disagreements} disagreements
          </span>
        ) : null}
        {field.kind === "number" && field.sparkline ? (
          <svg className="intel-spark" viewBox="0 0 72 28" aria-hidden="true">
            <path
              d={field.sparkline}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
        ) : null}
        <span className="intel-evidence-action">
          {open ? "Close details −" : "View matches +"}
        </span>
      </button>
      {open ? (
        <div id={id} className="intel-sb-detail">
          <p>{evidence.definition}</p>
          {field.kind === "number" && !evidence.unit ? (
            <p className="app-muted">
              Units follow the form label; no separate unit was specified.
            </p>
          ) : null}
          <p className="app-muted">
            {field.kind === "number"
              ? "Observed range: " +
                field.min +
                "–" +
                field.max +
                (evidence.unit ? " " + evidence.unit : "") +
                ". Each robot-match counts once; multiple numeric reports are averaged within that match first."
              : "Repeated reports are combined within each robot-match. Conflicting selections use the most frequent answer; a tie stays unanswered."}{" "}
            Missing answers are excluded; recorded zeroes count.{" "}
            {evidence.answered < 3
              ? "Small sample — use these observations with care."
              : ""}
          </p>
          {field.kind === "number" && field.recentDelta !== null ? (
            <p className="app-muted">
              Last three observed matches average{" "}
              {field.recentDelta >= 0 ? "+" : ""}
              {field.recentDelta} versus the overall average. This describes
              observations, not a prediction.
            </p>
          ) : null}
          {field.kind === "split" ? (
            <ul className="intel-sb-split">
              {field.options.map((option) => (
                <li key={option.value}>
                  <span>{option.value}</span>
                  <span>
                    {option.count} / {field.total}
                  </span>
                  <b>{Math.round(option.share * 100)}%</b>
                </li>
              ))}
            </ul>
          ) : null}
          <div
            className="intel-evidence-table-wrap"
            tabIndex={0}
            role="region"
            aria-label={field.label + " supporting matches"}
          >
            <table className="intel-evidence-table">
              <caption>{field.label}: observations behind this summary</caption>
              <thead>
                <tr>
                  <th scope="col">Match</th>
                  <th scope="col">Combined answer</th>
                  <th scope="col">Individual reports</th>
                </tr>
              </thead>
              <tbody>
                {evidence.samples.map((sample, index) => (
                  <tr key={(sample.matchKey ?? "") + index}>
                    <th scope="row">{sample.match}</th>
                    <td>{answer(sample.value)}</td>
                    <td>
                      {sample.reports.length
                        ? sample.reports.map(answer).join(" · ")
                        : "Not recorded"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

export function IntelScoutBreakdown({
  breakdown,
  title = "From our scouting",
  showNotes = true,
}: {
  breakdown: ScoutBreakdown;
  title?: string;
  showNotes?: boolean;
}) {
  const [query, setQuery] = useState("");
  const fields = breakdown.fields.filter((field) =>
    field.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <section className="intel-lookup-board" aria-label={title}>
      <header className="intel-evidence-header">
        <div>
          <h3>{title}</h3>
          <p className="app-muted">
            {breakdown.matches
              ? breakdown.matches +
                " unique matches. Open any metric to inspect its evidence."
              : "No match observations in this selection yet."}
          </p>
        </div>
        {breakdown.fields.length > 6 ? (
          <label className="intel-metric-search">
            Find a metric
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Auto, climb, cycles…"
            />
          </label>
        ) : null}
      </header>
      {breakdown.disagreements?.length ? (
        <p className="intel-evidence-warning" role="status">
          Reports disagree on {breakdown.disagreements.length} match-field
          observations. Inspect individual answers before making a close
          decision.
        </p>
      ) : null}
      <div className="intel-lookup-grid">
        {fields.map((field) => (
          <MetricTile key={field.key} field={field} />
        ))}
      </div>
      {query && !fields.length ? (
        <p className="app-muted">No metrics match “{query}”.</p>
      ) : null}
      {showNotes && breakdown.notes.length ? (
        <ul className="intel-sb-notes" aria-label="Scout notes">
          {breakdown.notes.map((note, index) => (
            <li key={note.match + index}>
              <span className="app-badge">{note.match}</span>
              <p>{note.text}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
