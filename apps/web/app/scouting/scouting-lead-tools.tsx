"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { ScoutSchema } from "@vantage/scouting";
import { Button, FormRow, Panel } from "../../components/ui";
import { shouldShowScoutingRecentEntries } from "../../lib/scouting/scouting-related";
import type { Bootstrap, TrustSnapshot } from "./scouting-model";
import { ScoutReportViewer } from "./scout-report-viewer";

/** Wide enough that the tools sit in their own column beside the form. */
const SIDE_COLUMN_QUERY = "(min-width: 1100px)";

/**
 * Saved entries, the accuracy board, the CSV and the coach formula.
 *
 * On a phone these used to follow Save as three full panels, about 3,500px of
 * a scout's page: thirty report links, a leaderboard and a formula editor
 * between one match and the next. None of it is part of scouting a match, so
 * on a phone it is one closed row under the form. On a wide screen, where it
 * sits in a column beside the form and costs a scout nothing, it opens.
 */
export function ScoutingLeadTools({
  orgId,
  data,
  schema,
  trust,
  showFormula,
  formulaName,
  formulaWeights,
  setShowFormula,
  setFormulaName,
  setFormulaWeights,
  saveFormula,
  sync,
}: {
  orgId: string;
  data: Bootstrap | null;
  schema: ScoutSchema | undefined;
  trust: TrustSnapshot | null;
  showFormula: boolean;
  formulaName: string;
  formulaWeights: Record<string, number>;
  setShowFormula: Dispatch<SetStateAction<boolean>>;
  setFormulaName: (name: string) => void;
  setFormulaWeights: Dispatch<SetStateAction<Record<string, number>>>;
  saveFormula: () => Promise<void> | void;
  sync: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (window.matchMedia(SIDE_COLUMN_QUERY).matches) setOpen(true);
    } catch {
      // No matchMedia: stay closed, which is the phone layout.
    }
  }, []);

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
        <summary>
          <span>{data?.canManageSchemas ? "Saved entries and lead tools" : "My saved entries"}</span>
          <small>{entries.length ? `${entries.length} recent` : "Nothing saved yet"}</small>
        </summary>
        <div className="scout-lead-tools-body">
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

          <Panel style={{ minHeight: "auto" }}>
            <button type="button" className="text-button" onClick={() => setShowFormula((current) => !current)}>
              {showFormula ? "Hide coach formula" : "Coach value formula"}
            </button>
            {showFormula ? (
              <div className="scout-formula">
                <p className="app-muted">Optional weighted score from numeric fields. Coach role required to save.</p>
                <FormRow label="Formula name">
                  <input
                    aria-label="Formula name"
                    placeholder="e.g. Pick value"
                    value={formulaName}
                    onChange={(event) => setFormulaName(event.target.value)}
                  />
                </FormRow>
                {schema?.definition.fields
                  .filter(
                    (field) =>
                      // Counters, ratings, and sliders store plain numbers too —
                      // a tap-tallied cycle count is exactly what a pick formula wants.
                      field.type === "number" ||
                      field.type === "counter" ||
                      field.type === "rating" ||
                      field.type === "slider",
                  )
                  .map((field) => (
                    <FormRow key={field.key} label={`${field.label} weight`}>
                      <input
                        type="number"
                        value={formulaWeights[field.key] ?? 0}
                        onChange={(event) =>
                          setFormulaWeights((current) => ({
                            ...current,
                            [field.key]: event.target.valueAsNumber,
                          }))
                        }
                      />
                    </FormRow>
                  ))}
                <Button variant="secondary" type="button" onClick={() => void saveFormula()}>
                  Save formula
                </Button>
              </div>
            ) : null}
          </Panel>
        </div>
      </details>
    </aside>
  );
}
