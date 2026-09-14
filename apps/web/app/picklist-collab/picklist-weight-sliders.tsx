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
  return (
    <section className="app-card soft-panel picklist-weight-sliders" aria-label="How much each rating matters">
      <header>
        <h2>Compared to this event</h2>
        <p className="app-muted">
          Drag a slider to change how much that rating moves the list. Scout-only ratings stay off
          until this team has real scout rows — we never invent them.
        </p>
        <Button variant="ghost" size="sm" type="button" onClick={onReset}>
          Reset weights
        </Button>
      </header>
      <ol className="picklist-weight-sliders-list">
        {PICKLIST_METRICS.map((metric) => {
          const weight = weightById.get(metric.id) ?? 0;
          const field = fieldStats[metric.id];
          const ready = metric.source === "event" && field != null;
          return (
            <li key={metric.id}>
              <label>
                <span>
                  {metric.label}
                  <small className="app-muted">
                    {ready
                      ? `${field.n} teams at this event`
                      : metric.source === "scout"
                        ? "Needs setup — no scout rows yet"
                        : "Need two teams at this event with this rating"}
                  </small>
                </span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={weight}
                  disabled={!ready}
                  aria-label={`${metric.label} weight`}
                  onChange={(event) => onWeight(metric.id, Number(event.target.value))}
                />
                <b aria-hidden="true">{ready ? weight.toFixed(1) : "—"}</b>
              </label>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
