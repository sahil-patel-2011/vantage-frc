"use client";
import { MatchActivityReport } from "../scouting/match-activity-report";

import { useMemo, useState } from "react";
import type { IntelScoutNote } from "../../lib/intel/intel-related";
import {
  buildScoutBreakdown,
  fieldLabel,
  matchKeyLabel,
  matchSortValue,
} from "../../lib/scouting/scout-breakdown";
import {
  observationEvent,
  scopeObservations,
} from "../../lib/scouting/observation-scope";
import { IntelScoutBreakdown } from "./intel-scout-breakdown";
import { ScoutPositionEvidence } from "./scout-position-evidence";
import type { FieldDefinition } from "@vantage/scouting";

function ReportAnswer({
  value,
  field,
}: {
  value: unknown;
  field?: FieldDefinition;
}) {
  if (field?.type === "auto_path" || field?.type === "field_position")
    return <ScoutPositionEvidence field={field} value={value} />;
  return (
    <>
      {value == null || value === ""
        ? "Not recorded"
        : typeof value === "boolean"
          ? value
            ? "Yes"
            : "No"
          : typeof value === "object"
            ? JSON.stringify(value)
            : String(value)}
    </>
  );
}

export function ScoutObservationExplorer({
  rows,
  activeEventKey,
  sourceLabel = "your team",
  privateNotes = true,
  sectionView,
}: {
  rows: IntelScoutNote[];
  activeEventKey: string | null;
  sourceLabel?: string;
  privateNotes?: boolean;
  /** Embed one result section in a robot profile without a second navigation bar. */
  sectionView?: "metrics" | "matches" | "notes";
}) {
  const [eventKey, setEventKey] = useState(activeEventKey ?? "");
  const [matchKey, setMatchKey] = useState("");
  const [includeLow, setIncludeLow] = useState(false);
  const [selectedSection, setSection] = useState<"metrics" | "matches" | "notes">(
    "metrics",
  );
  const section = sectionView ?? selectedSection;
  const events = [
    ...new Set(
      rows.map(observationEvent).filter((key): key is string => Boolean(key)),
    ),
  ];
  if (activeEventKey && !events.includes(activeEventKey))
    events.unshift(activeEventKey);
  const inEvent = scopeObservations(rows, eventKey, "", true);
  const matches = [
    ...new Set(
      inEvent
        .map((row) => row.matchKey)
        .filter((key): key is string => Boolean(key)),
    ),
  ].sort((a, b) => matchSortValue(a) - matchSortValue(b));
  const scoped = useMemo(
    () => scopeObservations(rows, eventKey, matchKey, includeLow),
    [rows, eventKey, matchKey, includeLow],
  );
  const breakdown = useMemo(
    () => buildScoutBreakdown(scoped.filter((row) => row.matchKey)),
    [scoped],
  );
  const low = inEvent.filter((row) => row.confidence === "low").length;
  return (
    <section
      className="intel-observation-explorer"
      aria-label="Scouting results"
    >
      <div className="intel-observation-controls">
        <label>
          Event
          <select
            value={eventKey}
            onChange={(event) => {
              setEventKey(event.target.value);
              setMatchKey("");
            }}
          >
            <option value="">All recorded events</option>
            {events.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>
        <label>
          Match
          <select
            value={matchKey}
            onChange={(event) => setMatchKey(event.target.value)}
          >
            <option value="">All matches</option>
            {matches.map((key) => (
              <option key={key} value={key}>
                {matchKeyLabel(key)}
              </option>
            ))}
          </select>
        </label>
        {low ? (
          <label className="intel-confidence-filter">
            <input
              type="checkbox"
              checked={includeLow}
              onChange={(event) => setIncludeLow(event.target.checked)}
            />
            Include {low} low-confidence reports
          </label>
        ) : null}
      </div>
      {!sectionView ? <div
        className="intel-observation-sections"
        role="group"
        aria-label="Scouting result view"
      >
        {(
          [
            ["metrics", "Capabilities"],
            ["matches", "Match reports"],
            ["notes", "Private notes"],
          ] as const
        )
          .filter(([key]) => privateNotes || key !== "notes")
          .map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={section === key}
              onClick={() => setSection(key)}
            >
              {label}
            </button>
          ))}
      </div> : null}
      <p className="app-muted intel-observation-scope">
        Source: {sourceLabel} · {scoped.filter((row) => row.matchKey).length}{" "}
        reports · {breakdown.matches} unique matches
        {!includeLow && low
          ? " · " + low + " low-confidence reports excluded"
          : ""}
      </p>
      {section === "metrics" ? (
        <IntelScoutBreakdown
          breakdown={breakdown}
          showNotes={false}
          title={privateNotes ? "From our scouting" : "Shared observations"}
        />
      ) : null}
      {section === "notes" ? (
        <>
          <h3>Private scout notes</h3>
          <p className="app-muted">
            Visible to your team. Excluded from shared scouting.
          </p>
          {breakdown.notes.length ? (
            <ul className="intel-sb-notes">
              {breakdown.notes.map((note, index) => (
                <li key={index}>
                  <span className="app-badge">{note.match}</span>
                  <p>{note.text}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No notes in this selection.</p>
          )}
        </>
      ) : null}
      {section === "matches" ? (
        <div className="intel-report-list">
          <h3>Original match reports</h3>
          <p className="app-muted">
            Every submitted report stays visible here, including disagreements.
            Positions and paths are recorded grid cells.
          </p>
          {scoped
            .filter((row) => row.matchKey)
            .sort(
              (a, b) => matchSortValue(a.matchKey) - matchSortValue(b.matchKey),
            )
            .map((row, index) => (
              <details key={(row.matchKey ?? "") + index}>
                <summary data-disclosure>
                  {matchKeyLabel(row.matchKey)} · report {index + 1}
                  <span>{row.confidence} confidence</span>
                </summary>
                <dl>
                  {Object.entries(row.payload)
                    .filter(
                      ([key]) =>
                        !key.startsWith("_") &&
                        !/^(scout|user|email|name)/i.test(key),
                    )
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt>
                          {row.fields?.find((field) => field.key === key)
                            ?.label ?? fieldLabel(key)}
                        </dt>
                        <dd>
                          <ReportAnswer
                            value={value}
                            field={row.fields?.find(
                              (field) => field.key === key,
                            )}
                          />
                        </dd>
                      </div>
                    ))}
                </dl>
                {privateNotes ? <MatchActivityReport payload={row.payload} /> : null}
              </details>
            ))}
          {!breakdown.matches ? (
            <p>No match reports in this selection.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
