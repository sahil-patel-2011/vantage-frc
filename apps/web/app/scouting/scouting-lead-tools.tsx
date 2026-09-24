"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { ScoutSchema } from "@vantage/scouting";
import { Button, FormRow, Panel } from "../../components/ui";
import { ExportButton } from "../../components/ui/export-button";
import { scoutEventLabel, shouldShowScoutingRecentEntries } from "../../lib/scouting/scouting-related";
import { SCOUT_ENTRY_CSV_COLUMNS, type Bootstrap, type TrustSnapshot } from "./scouting-model";
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
  const eventLabel = scoutEventLabel({ eventName: data?.eventName, eventKey: data?.eventKey });

  return (
    <aside className="scout-side">
      <details
        className="scout-lead-tools"
        open={open}
        onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>
          <span>Saved entries and lead tools</span>
          <small>{entries.length ? `${entries.length} recent` : "Nothing saved yet"}</small>
        </summary>
        <div className="scout-lead-tools-body">
          <Panel id="recent-entries" className="scout-activity" style={{ minHeight: "auto" }}>
            <h2 style={{ marginTop: 0 }}>Saved entries</h2>
            <p className="app-muted">Tap one to see what was recorded. Made a mistake? Press Fix it on the green Saved note right after saving. Team leads can delete a report.</p>
            {data && shouldShowScoutingRecentEntries(entries.length) ? (
              <>
                <ExportButton
                  rows={entries}
                  columns={SCOUT_ENTRY_CSV_COLUMNS}
                  feature="Scouting entries"
                  orgLabel={eventLabel}
                  orgId={orgId}
                  size="sm"
                  provenance={`${
                    eventLabel ?? "Active event"
                  } — the 30 most recent synced entries only. Anything still queued offline, and the rest of the event, is in the full export.`}
                />
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
            {trust?.leaderboard?.length ? (
              <ol className="scout-accuracy-mini">
                {trust.leaderboard.slice(0, 5).map((scout, index) => (
                  <li key={scout.userId}>
                    <span className="scout-accuracy-rank">{index + 1}</span>
                    <div>
                      <strong>{scout.name}</strong>
                      <small className="app-muted">
                        {scout.checks} checked · {scout.entries} entries
                      </small>
                    </div>
                    <b>{scout.accuracy == null ? "—" : `${Math.round(scout.accuracy * 100)}%`}</b>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="app-muted">Appears once official scores are in for matches you scouted.</p>
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
