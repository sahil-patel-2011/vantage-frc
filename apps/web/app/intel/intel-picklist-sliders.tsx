"use client";

import { useMemo, useState } from "react";
import {
  PICKLIST_METRICS,
  picklistPresetWeights,
  rankByWeightedZScores,
  type MetricWeight,
  type PicklistPresetId,
  type TeamMetricRow,
} from "@vantage/prediction-strategy";
import { Button, Panel } from "../../components/ui";
import {
  applyPicklistDisplayOrder,
  eventRowsToMetricRows,
  movePicklistKey,
  type EventRatingRow,
  type PicklistMoveDirection,
  type ScoutAverageRow,
} from "../../lib/intel/lovat-lookup";

const PRESETS: ReadonlyArray<{ id: PicklistPresetId; label: string }> = [
  { id: "event", label: "Event ratings" },
  { id: "scouting", label: "Our scouting" },
  { id: "teleopDriver", label: "Teleop + driver" },
];

function mergeScout(row: TeamMetricRow, scout: ScoutAverageRow | null | undefined): TeamMetricRow {
  if (!scout || scout.teamKey !== row.teamKey) return row;
  return { teamKey: row.teamKey, values: { ...row.values, ...scout.values } };
}

export function IntelPicklistSliders({
  teamKey,
  fieldRatings,
  scout,
}: {
  teamKey: string;
  fieldRatings: EventRatingRow[];
  scout?: ScoutAverageRow | null;
}) {
  const [weights, setWeights] = useState<MetricWeight[]>(() => picklistPresetWeights("event"));
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null);
  const rows = useMemo(
    () => eventRowsToMetricRows(fieldRatings).map((row) => mergeScout(row, scout)),
    [fieldRatings, scout],
  );
  const ranked = useMemo(() => rankByWeightedZScores(rows, weights), [rows, weights]);
  const self = ranked.find((row) => row.teamKey === teamKey);
  const placed = ranked.filter((row) => row.score != null);
  const displayRows = applyPicklistDisplayOrder(placed, orderOverride);

  function setPreset(id: PicklistPresetId) {
    setWeights(picklistPresetWeights(id));
    setOrderOverride(null);
  }

  function moveTeam(key: string, direction: PicklistMoveDirection) {
    const keys = orderOverride ?? placed.map((row) => row.teamKey);
    setOrderOverride(movePicklistKey(keys, key, direction));
  }

  function setWeight(id: MetricWeight["id"], weight: number) {
    setWeights((current) => current.map((item) => (item.id === id ? { ...item, weight } : item)));
  }

  const selfRank = self?.score != null ? placed.findIndex((row) => row.teamKey === teamKey) + 1 : null;

  return (
    <Panel className="intel-picklist" style={{ minHeight: "auto" }}>
      <h3 style={{ marginTop: 0 }}>Picklist</h3>
      <p className="app-muted">
        Drag sliders to weight this event. Teams without a real number for a slider are skipped. Adjust order only
        changes this screen — scores stay computed. Save from the pick desk or Save as #1 pick.
      </p>
      <div className="intel-phase-row" role="group" aria-label="Picklist presets">
        {PRESETS.map((preset) => (
          <Button key={preset.id} variant="secondary" type="button" onClick={() => setPreset(preset.id)}>
            {preset.label}
          </Button>
        ))}
      </div>
      <ul className="intel-slider-list">
        {PICKLIST_METRICS.map((metric) => {
          const weight = weights.find((item) => item.id === metric.id)?.weight ?? 0;
          return (
            <li key={metric.id}>
              <label htmlFor={`pick-slider-${metric.id}`}>
                <span>{metric.label}</span>
                <em className="app-muted">{metric.source === "event" ? "Event" : "Our scouting"}</em>
              </label>
              <input
                id={`pick-slider-${metric.id}`}
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={weight}
                onChange={(event) => setWeight(metric.id, Number(event.target.value))}
              />
              <b>{weight.toFixed(2)}</b>
            </li>
          );
        })}
      </ul>
      {placed.length ? (
        <p className="intel-pick-self">
          This team{" "}
          <strong>
            {selfRank != null && self?.score != null
              ? `#${selfRank} · ${self.score.toFixed(2)}`
              : "Needs setup — no weighted numbers yet"}
          </strong>
        </p>
      ) : (
        <p className="app-muted">Needs setup — sync event ratings before ranking this field.</p>
      )}
      {placed.length ? (
        <>
          <div className="intel-pick-adjust">
            <h4>Adjust order</h4>
            {orderOverride ? (
              <Button variant="secondary" type="button" onClick={() => setOrderOverride(null)}>
                Reset to computed
              </Button>
            ) : null}
          </div>
          <ol className="intel-pick-rank">
            {displayRows.map((row, index) => {
              const number = row.teamKey.replace(/^frc/i, "");
              return (
                <li key={row.teamKey} className={row.teamKey === teamKey ? "is-self" : undefined}>
                  <span>{index + 1}</span>
                  <b>{number}</b>
                  <em>{row.score?.toFixed(2)}</em>
                  {displayRows.length > 1 ? (
                    <span className="intel-pick-move">
                      <button
                        type="button"
                        className="qol-press"
                        aria-label={`Move ${number} up`}
                        disabled={index === 0}
                        onClick={() => moveTeam(row.teamKey, "up")}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className="qol-press"
                        aria-label={`Move ${number} down`}
                        disabled={index === displayRows.length - 1}
                        onClick={() => moveTeam(row.teamKey, "down")}
                      >
                        Down
                      </button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
    </Panel>
  );
}
