"use client";

import { useMemo, useState } from "react";
import {
  picklistMetricLabel,
  isFormMetricId,
  rankByWeightedZScores,
  type FieldStats,
  type MetricWeight,
  type TeamMetricRow,
} from "@vantage/prediction-strategy";
import { Button, Panel } from "../../components/ui";
import type { FormMetricDefinitions, FormMetricSamples } from "../../lib/picklist-collab/form-metrics";

const SHOWN = 12;

/**
 * Every team at the event, ranked by the sliders right now.
 *
 * This is the Lovat "dynamic pick list": move a slider and the order moves.
 * The pick list itself (tiers, votes) stays the team's decision; this is the
 * evidence it is decided from, with one tap to put a team on the list.
 *
 * The bar is the team's score relative to the best score shown — a picture of
 * the gaps, not a number of its own. The "why" line names the two ratings
 * that pushed it up most, so the order is never a black box.
 */
export function PicklistEventRanking({
  eventTeams,
  weights,
  fieldStats,
  formSamples,
  formDefinitions,
  onList,
  busy,
  onAdd,
  canAdd = true,
}: {
  eventTeams: TeamMetricRow[];
  weights: MetricWeight[];
  fieldStats: FieldStats;
  formSamples?: FormMetricSamples;
  formDefinitions?: FormMetricDefinitions;
  onList: Set<number>;
  busy: boolean;
  onAdd: (teamNumber: number) => void;
  canAdd?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const ranked = useMemo(
    () => rankByWeightedZScores(eventTeams, weights, fieldStats).filter((row) => row.score != null),
    [eventTeams, weights, fieldStats],
  );
  if (ranked.length === 0) return <Panel className="picklist-collab-panel picklist-event-ranking"><h2>Comparison ranking</h2><p className="app-muted">No teams have usable data for the selected weights. Give an available metric a weight above zero, or collect more observations.</p></Panel>;
  const activeMetrics = weights.filter(metric => metric.weight > 0 && fieldStats[metric.id]).length;
  const top = ranked[0]?.score ?? 0;
  const bottom = ranked[ranked.length - 1]?.score ?? 0;
  const span = Math.max(0.0001, top - bottom);
  const rows = showAll ? ranked : ranked.slice(0, SHOWN);

  return (
    <Panel className="picklist-collab-panel picklist-event-ranking" aria-label="Every team at this event, ranked">
      <header>
        <h2 style={{ margin: 0 }}>Ranked by your sliders</h2>
        <p className="app-muted">
          All {ranked.length} rated teams at this event, re-ranked as you drag. Add the ones you want to talk about.
          {eventTeams.length > ranked.length ? ` ${eventTeams.length - ranked.length} teams have no usable data for these weights.` : ""}
        </p>
      </header>
      <ol className="picklist-event-ranking-list">
        {rows.map((row, index) => {
          const teamNumber = Number(row.teamKey.replace(/^frc/, ""));
          const why = [...row.breakdown]
            .filter((term) => term.term > 0)
            .sort((a, b) => b.term - a.term)
            .slice(0, 2)
            .map((term) => (isFormMetricId(term.id) ? formDefinitions?.[term.id]?.label ?? picklistMetricLabel(term.id) : picklistMetricLabel(term.id)).toLowerCase());
          const samples = row.breakdown.flatMap(term => {
            if (!isFormMetricId(term.id)) return [];
            const count = formSamples?.[row.teamKey]?.[term.id];
            return typeof count === "number" && Number.isSafeInteger(count) && count > 0 ? [count] : [];
          });
          const smallest = samples.length ? Math.min(...samples) : null;
          const largest = samples.length ? Math.max(...samples) : null;
          const sampleCopy = smallest === null ? "" : ` · form samples: ${smallest === largest ? smallest : `${smallest}–${largest}`} observed match${largest === 1 ? "" : "es"} each`;
          const width = `${Math.max(4, (((row.score ?? bottom) - bottom) / span) * 100)}%`;
          const listed = onList.has(teamNumber);
          return (
            <li key={row.teamKey}>
              <span className="picklist-event-rank">{index + 1}</span>
              <strong>{teamNumber}</strong>
              <span className="picklist-event-bar" aria-hidden="true">
                <i style={{ width }} />
              </span>
              <small className="app-muted picklist-event-why" title={`${row.breakdown.length} of ${activeMetrics} weighted metrics observed${sampleCopy}${why.length ? ` · strong: ${why.join(", ")}` : ""}`}>{row.breakdown.length}/{activeMetrics} metrics{sampleCopy}{why.length ? ` · strong: ${why.join(", ")}` : ""}</small>
              {listed ? (
                <span className="app-badge">On list</span>
              ) : canAdd ? (
                <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={() => onAdd(teamNumber)}>
                  Add
                </Button>
              ) : <span className="app-muted">Not on list</span>}
            </li>
          );
        })}
      </ol>
      {ranked.length > SHOWN ? (
        <button type="button" className="text-button" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show the top 12" : `Show all ${ranked.length}`}
        </button>
      ) : null}
    </Panel>
  );
}
