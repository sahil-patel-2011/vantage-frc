"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  picklistMetricLabel,
  scoutingPicklistWeights,
  type MetricWeight,
  type PicklistMetricId,
} from "@vantage/prediction-strategy";

/**
 * What this team is looking for, as four or five sliders.
 *
 * The ranking underneath has always supported weights; the Robots screen
 * opened with a fixed set and no way to change them. But "who should we pick"
 * is not one question — a team with a weak endgame wants a climber, a team
 * that has been knocked out twice wants a robot that finishes, and an alliance
 * captain with the first pick wants raw scoring. One fixed order answers none
 * of those well and quietly implies there is a right answer.
 *
 * Deliberately a short list. The ranking knows about seventeen metrics and
 * scouting fills seven of them; showing seventeen sliders, most of them dead,
 * is how a tuning control becomes something nobody touches.
 */

/** The metrics scouting actually fills, in the order a team thinks about them. */
export const TUNABLE_METRICS: readonly PicklistMetricId[] = [
  "totalPoints",
  "consistency",
  "reliability",
  "endgameClimb",
  "autoPoints",
  "defenseEffectiveness",
];

/** 0 to 2, in tenths — 1 is "normal", 2 is "this is what decides it". */
const MAX_WEIGHT = 2;
const STEP = 0.1;

const storageKey = (orgId: string) => `vantage.picklist.weights.${orgId}`;

function defaults(): MetricWeight[] {
  const base = new Map(scoutingPicklistWeights().map((w) => [w.id as PicklistMetricId, w.weight]));
  return TUNABLE_METRICS.map((id) => ({ id, weight: base.get(id) ?? 0 }));
}

/**
 * Remembered per team, on this device only.
 *
 * A pick-list weighting is a working preference, not team data — two people
 * at the same table may reasonably want to look at it differently, and a
 * shared value would have one of them overwriting the other mid-meeting.
 * Every read and write is guarded: blocked storage is a normal state, not an
 * error, and the sliders must work without it.
 */
function load(orgId: string): MetricWeight[] {
  try {
    const raw = window.localStorage.getItem(storageKey(orgId));
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaults();
    const byId = new Map<string, number>();
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const { id, weight } = entry as { id?: unknown; weight?: unknown };
      if (typeof id !== "string" || typeof weight !== "number" || !Number.isFinite(weight)) continue;
      byId.set(id, Math.min(MAX_WEIGHT, Math.max(0, weight)));
    }
    if (byId.size === 0) return defaults();
    const base = new Map(defaults().map((w) => [w.id, w.weight]));
    return TUNABLE_METRICS.map((id) => ({ id, weight: byId.get(id) ?? base.get(id) ?? 0 }));
  } catch {
    return defaults();
  }
}

export function usePickWeights(orgId: string) {
  const [weights, setWeights] = useState<MetricWeight[]>(() => defaults());

  // Read after mount, not during render: the server has no localStorage, and
  // reading it in the initialiser makes the first client render disagree with
  // the HTML that was sent.
  useEffect(() => {
    setWeights(load(orgId));
  }, [orgId]);

  const update = useCallback(
    (id: PicklistMetricId, weight: number) => {
      setWeights((current) => {
        const next = current.map((entry) =>
          entry.id === id ? { ...entry, weight: Math.min(MAX_WEIGHT, Math.max(0, weight)) } : entry,
        );
        try {
          window.localStorage.setItem(storageKey(orgId), JSON.stringify(next));
        } catch {
          // Private mode or blocked storage. The sliders still work; they just
          // do not survive a reload, which is a fair trade for not throwing.
        }
        return next;
      });
    },
    [orgId],
  );

  const reset = useCallback(() => {
    setWeights(defaults());
    try {
      window.localStorage.removeItem(storageKey(orgId));
    } catch {
      /* see above */
    }
  }, [orgId]);

  const changed = useMemo(() => {
    const base = new Map(defaults().map((w) => [w.id, w.weight]));
    return weights.some((entry) => base.get(entry.id) !== entry.weight);
  }, [weights]);

  return { weights, update, reset, changed };
}

export function PickWeightSliders({
  weights,
  onChange,
  onReset,
  changed,
}: {
  weights: MetricWeight[];
  onChange: (id: PicklistMetricId, weight: number) => void;
  onReset: () => void;
  changed: boolean;
}) {
  return (
    <section className="stp-weights" aria-label="What you are looking for">
      <header>
        <h3>What are you looking for?</h3>
        {changed ? (
          <button type="button" onClick={onReset}>
            Reset
          </button>
        ) : null}
      </header>
      <div className="stp-weight-grid">
        {weights.map((entry) => (
          <label key={entry.id}>
            <span className="stp-weight-name">{picklistMetricLabel(entry.id)}</span>
            <input
              type="range"
              min={0}
              max={MAX_WEIGHT}
              step={STEP}
              value={entry.weight}
              onChange={(event) => onChange(entry.id, Number(event.target.value))}
              // The value on its own means nothing to a student, so the name
              // is in the label a screen reader reads.
              aria-label={`How much ${picklistMetricLabel(entry.id).toLowerCase()} matters`}
              aria-valuetext={weightWord(entry.weight)}
            />
            <span className="stp-weight-value" data-off={entry.weight === 0 ? "yes" : undefined}>
              {weightWord(entry.weight)}
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

/**
 * Words, not numbers. "1.3" tells a student nothing about what the list will
 * do; "matters a lot" does, and it is the same information.
 */
export function weightWord(weight: number): string {
  if (weight <= 0) return "Ignore";
  if (weight < 0.5) return "A little";
  if (weight < 1.1) return "Normal";
  if (weight < 1.6) return "A lot";
  return "Decides it";
}
