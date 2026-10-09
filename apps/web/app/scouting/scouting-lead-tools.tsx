"use client";

import { useState } from "react";
import { hubHref } from "../../lib/nav/hubs";
import { Panel } from "../../components/ui";
import { shouldShowScoutingRecentEntries } from "../../lib/scouting/scouting-related";
import type { Bootstrap, TrustSnapshot } from "./scouting-model";
import { ScoutReportViewer } from "./scout-report-viewer";


/**
 * Saved entries, the accuracy board, the CSV and the coach formula.
 *
 * On a phone these used to follow Save as three full panels, about 3,500px of
 * a scout's page: thirty report links, a leaderboard and a formula editor
 * between one match and the next. None of it is part of scouting a match, so
 * it is one closed, clearly named row at every width. A lead can open it to
 * inspect reports without distracting a scout from the active match.
 */
export function ScoutingLeadTools({
  orgId,
  data,
  trust,
  sync,
}: {
  orgId: string;
  data: Bootstrap | null;
  trust: TrustSnapshot | null;
  sync: () => Promise<void> | void;
}) {
  // Match collection is the primary task at every width. Reports, export and
  // lead tools are available together on demand, not thirty competing buttons.
  const [open, setOpen] = useState(false);

  const entries = data?.recentEntries ?? [];
  // Only scouts with at least one report checked against an official score are
  // ranked, best agreement first. Ranking unchecked scouts ordered them by how
  // many forms they filled, which the heading says this is not.
  const accuracyBoard = (trust?.leaderboard ?? [])
    .filter((scout) => scout.checks > 0 && scout.accuracy != null)
    .sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0) || b.checks - a.checks);
  const exportHref = data?.eventKey
    ? `/api/scouting/export?orgId=${encodeURIComponent(orgId)}&eventKey=${encodeURIComponent(data.eventKey)}`
    : null;

  return (
    <aside className="scout-side">
      <details
        className="scout-lead-tools"
        open={open}
        onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary data-disclosure>
          <span>{data?.canManageSchemas ? "Saved entries and lead tools" : "My saved entries"}</span>
          <small>{entries.length ? `${entries.length} recent` : "Nothing saved yet"}</small>
        </summary>
        <div className="scout-lead-tools-body">
          <p><a href={`/scout?orgId=${encodeURIComponent(orgId)}`}>Prepare this device for scouting →</a></p>
          {data?.canManageSchemas ? <nav className="scout-setup-actions" aria-label="Scouting setup">
            <a href={hubHref("/competition", "forms", orgId)}>Edit forms</a>
            <a href={`${hubHref("/competition", "forms", orgId)}&formulas=1`}>Scoring formulas</a>
            <a href={hubHref("/competition", "scout-coverage-live", orgId)}>Assign scouts</a>
            <a href={hubHref("/competition", "scout-training-mode", orgId)}>Practice scouting</a>
          </nav> : null}
          <Panel id="recent-entries" className="scout-activity" style={{ minHeight: "auto" }}>
            <h2 style={{ marginTop: 0 }}>Saved entries</h2>
            <p className="app-muted">Tap one to see what was recorded.</p>
            {data && shouldShowScoutingRecentEntries(entries.length) ? (
              <>
                {data.canManageSchemas && exportHref ? (
                  <p className="scout-export-all" style={{ display: "grid", gap: 6, margin: "0 0 12px" }}>
                    <a className="app-button secondary" href={exportHref} download>
                      Export all match scouting
                    </a>
                    <small className="app-muted">
                      Every report at this event, with each answer, in match order. Reports still waiting to
                      upload from a phone are not in it yet.
                    </small>
                  </p>
                ) : null}
                <ScoutReportViewer
                  entries={entries}
                  orgId={orgId}
                  canDelete={Boolean(data.canManageSchemas)}
                  onDeleted={() => void sync()}
                />
              </>
            ) : (
              <p className="app-muted">No entries yet for this event.</p>
            )}
          </Panel>

          <Panel className="scout-activity" style={{ minHeight: "auto" }}>
            <h2 style={{ marginTop: 0 }}>Most accurate scouts</h2>
            <p className="app-muted">Checked against the official scores, not by how many forms were filled.</p>
            {accuracyBoard.length ? (
              <ol className="scout-accuracy-mini">
                {accuracyBoard.slice(0, 5).map((scout, index) => (
                  <li key={scout.userId}>
                    <span className="scout-accuracy-rank">{index + 1}</span>
                    <div>
                      <strong>{scout.name?.trim() || "Team scout"}</strong>
                      <small className="app-muted">
                        {scout.checks} of {scout.entries} {scout.entries === 1 ? "report" : "reports"} checked
                      </small>
                    </div>
                    <b>{scout.accuracy == null ? "—" : `${Math.round(scout.accuracy * 100)}%`}</b>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="app-muted">
                Appears once the official score breakdown is posted for a match you scouted. Some events post
                only alliance totals; those can&apos;t check one robot.
              </p>
            )}
          </Panel>

        </div>
      </details>
    </aside>
  );
}
