"use client";

import { useEffect, useMemo, useState } from "react";
import {
  PICKLIST_METRICS,
  defaultPicklistWeights,
  type FieldStats,
  type MetricWeight,
  type PicklistMetricId,
} from "@vantage/prediction-strategy";
import { Button } from "../../components/ui";

const WEIGHTS_KEY = "vantage.picklist-field-weights.v1";
const METRIC_IDS = new Set(PICKLIST_METRICS.map((metric) => metric.id));

function parseStoredWeights(raw: string | null): MetricWeight[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const byId = new Map<PicklistMetricId, number>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const id = (item as { id?: unknown }).id;
      const weight = (item as { weight?: unknown }).weight;
      if (typeof id !== "string" || !METRIC_IDS.has(id as PicklistMetricId)) continue;
      if (typeof weight !== "number" || !Number.isFinite(weight)) continue;
      byId.set(id as PicklistMetricId, Math.min(2, Math.max(0, weight)));
    }
    if (byId.size === 0) return null;
    return defaultPicklistWeights().map((item) => ({
      id: item.id,
      weight: byId.get(item.id) ?? item.weight,
    }));
  } catch {
    return null;
  }
}

export function usePicklistFieldWeights(listId: string | null): {
  weights: MetricWeight[];
  setWeight: (id: PicklistMetricId, weight: number) => void;
  reset: () => void;
} {
  const [weights, setWeights] = useState<MetricWeight[]>(() => defaultPicklistWeights());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!listId || typeof window === "undefined") {
      setHydrated(false);
      return;
    }
    const stored = parseStoredWeights(window.localStorage.getItem(`${WEIGHTS_KEY}:${listId}`));
    setWeights(stored ?? defaultPicklistWeights());
    setHydrated(true);
  }, [listId]);

  useEffect(() => {
    if (!hydrated || !listId || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(`${WEIGHTS_KEY}:${listId}`, JSON.stringify(weights));
    } catch {
      // Best-effort — ranking still works for this session.
    }
  }, [hydrated, listId, weights]);

  return useMemo(
    () => ({
      weights,
      setWeight: (id: PicklistMetricId, weight: number) => {
        setWeights((prev) => prev.map((item) => (item.id === id ? { ...item, weight } : item)));
      },
      reset: () => setWeights(defaultPicklistWeights()),
    }),
    [weights],
  );
}

export function PicklistWeightSliders({
  weights,
  fieldStats,
  onWeight,
  onReset,
}: {
  weights: MetricWeight[];
  fieldStats: FieldStats;
  onWeight: (id: PicklistMetricId, weight: number) => void;
  onReset: () => void;
}) {
  const weightById = new Map(weights.map((item) => [item.id, item.weight]));
  // A slider that can never move is noise. Show the ones this event has data
  // for; say in one line how many are waiting on data.
  const ready = PICKLIST_METRICS.filter((metric) => (fieldStats[metric.id]?.n ?? 0) >= 2);
  const waiting = PICKLIST_METRICS.length - ready.length;
  return (
    <section className="app-card soft-panel picklist-weight-sliders" aria-label="How much each rating matters">
      <header>
        <h2>Compared to this event</h2>
        <p className="app-muted">
          Drag a slider to say how much that matters to your alliance — the ranking below moves as you drag.
          {waiting > 0 ? ` ${waiting} more turn on when your scouting form collects them.` : ""}
        </p>
        <Button variant="ghost" size="sm" type="button" onClick={onReset}>
          Reset weights
        </Button>
      </header>
      <ol className="picklist-weight-sliders-list">
        {ready.map((metric) => {
          const weight = weightById.get(metric.id) ?? 0;
          const field = fieldStats[metric.id]!;
          return (
            <li key={metric.id}>
              <label>
                <span>
                  {metric.label}
                  <small className="app-muted">
                    {metric.source === "scout" ? `our scouting · ${field.n} teams` : `${field.n} teams at this event`}
                  </small>
                </span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={weight}
                  aria-label={`${metric.label} weight`}
                  onChange={(event) => onWeight(metric.id, Number(event.target.value))}
                />
                <b aria-hidden="true">{weight.toFixed(1)}</b>
              </label>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
