"use client";

import { useMemo, useState } from "react";
import {
  picklistMetricLabel,
  rankByWeightedZScores,
  type FieldStats,
  type MetricWeight,
  type TeamMetricRow,
} from "@vantage/prediction-strategy";
import { Button, Panel } from "../../components/ui";

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
  onList,
  busy,
  onAdd,
}: {
  eventTeams: TeamMetricRow[];
  weights: MetricWeight[];
  fieldStats: FieldStats;
  onList: Set<number>;
  busy: boolean;
  onAdd: (teamNumber: number) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const ranked = useMemo(
    () => rankByWeightedZScores(eventTeams, weights, fieldStats).filter((row) => row.score != null),
    [eventTeams, weights, fieldStats],
  );
  if (ranked.length === 0) return null;
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
        </p>
      </header>
      <ol className="picklist-event-ranking-list">
        {rows.map((row, index) => {
          const teamNumber = Number(row.teamKey.replace(/^frc/, ""));
          const why = [...row.breakdown]
            .filter((term) => term.term > 0)
            .sort((a, b) => b.term - a.term)
            .slice(0, 2)
            .map((term) => picklistMetricLabel(term.id).toLowerCase());
          const width = `${Math.max(4, (((row.score ?? bottom) - bottom) / span) * 100)}%`;
          const listed = onList.has(teamNumber);
          return (
            <li key={row.teamKey}>
              <span className="picklist-event-rank">{index + 1}</span>
              <strong>{teamNumber}</strong>
              <span className="picklist-event-bar" aria-hidden="true">
                <i style={{ width }} />
              </span>
              <small className="app-muted picklist-event-why">{why.length ? `strong: ${why.join(", ")}` : ""}</small>
              {listed ? (
                <span className="app-badge">On list</span>
              ) : (
                <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={() => onAdd(teamNumber)}>
                  Add
                </Button>
              )}
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
