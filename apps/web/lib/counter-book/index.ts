// Pure, unit-testable counter-book helpers. No I/O, no framework imports — everything here
// operates on already-loaded scouted payloads and never fabricates a metric that isn't present.
import type { CounterBookFailureTrigger, CounterBookTendency } from "./types";

/** Minimum scouted observations for a field before it counts as a real tendency. */
export const MIN_TENDENCY_SAMPLE = 2;
/** Coefficient-of-variation threshold above which a tendency is flagged as a failure trigger. */
export const FAILURE_VARIABILITY_THRESHOLD = 0.35;

/** Turn a camelCase / snake_case scouting field key into a human label. */
export function counterBookFieldLabel(field: string): string {
  const spaced = field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Collect every top-level numeric field across scouted payloads, keyed by field name. */
export function collectNumericFields(payloads: Array<Record<string, unknown>>): Map<string, number[]> {
  const byField = new Map<string, number[]>();
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object") continue;
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const bucket = byField.get(key) ?? [];
      bucket.push(value);
      byField.set(key, bucket);
    }
  }
  return byField;
}

/** Derive real, non-fabricated tendencies from scouted numeric fields (average + variability). */
export function computeTendencies(
  payloads: Array<Record<string, unknown>>,
  minSample = MIN_TENDENCY_SAMPLE,
): CounterBookTendency[] {
  const byField = collectNumericFields(payloads);
  const tendencies: CounterBookTendency[] = [];
  for (const [field, values] of byField) {
    if (values.length < minSample) continue;
    const avg = mean(values);
    const sd = stdev(values, avg);
    const variability = avg !== 0 ? Math.abs(sd / avg) : 0;
    tendencies.push({ field, average: Math.round(avg * 100) / 100, sampleSize: values.length, variability: Math.round(variability * 1000) / 1000 });
  }
  return tendencies.sort((a, b) => b.average - a.average || b.sampleSize - a.sampleSize);
}

/** Fields with high inconsistency across scouted matches — a genuine, data-derived failure trigger. */
export function computeFailureTriggers(
  tendencies: CounterBookTendency[],
  threshold = FAILURE_VARIABILITY_THRESHOLD,
): CounterBookFailureTrigger[] {
  return tendencies
    .filter((t) => t.variability >= threshold)
    .sort((a, b) => b.variability - a.variability)
    .map((t) => ({
      field: t.field,
      detail: `${counterBookFieldLabel(t.field)} swings widely across scouted matches (avg ${t.average}, ${t.sampleSize} samples) — pressure here to force a below-average result.`,
      variability: t.variability,
    }));
}

/** Deterministic counter-strategy narrative grounded only in the tendencies/triggers computed above. */
export function buildCounterPlan(
  teamLabel: string,
  tendencies: CounterBookTendency[],
  failureTriggers: CounterBookFailureTrigger[],
): string {
  if (!tendencies.length) {
    return `No scouted numeric tendencies for ${teamLabel} yet. Log match scouting entries for this team before generating a counter-plan.`;
  }
  const top = tendencies[0]!;
  const lines = [
    `${teamLabel} leans hardest on ${counterBookFieldLabel(top.field)} (avg ${top.average} across ${top.sampleSize} scouted matches).`,
  ];
  if (failureTriggers.length) {
    const trigger = failureTriggers[0]!;
    lines.push(
      `Their most exploitable inconsistency is ${counterBookFieldLabel(trigger.field)} (variability ${(trigger.variability * 100).toFixed(0)}%) — plan defense or tempo to push them into that variance.`,
    );
  } else {
    lines.push(`No high-variance fields were flagged yet — their scouted performance has been consistent; out-execute rather than bait mistakes.`);
  }
  const secondary = tendencies.slice(1, 3);
  if (secondary.length) {
    lines.push(
      `Secondary tendencies to plan around: ${secondary.map((t) => `${counterBookFieldLabel(t.field)} (avg ${t.average})`).join(", ")}.`,
    );
  }
  return lines.join(" ");
}

export function buildCounterBookSummary(teamLabel: string, matchesScouted: number, tendencies: CounterBookTendency[]): string {
  if (matchesScouted === 0) return `No scouted matches for ${teamLabel} yet.`;
  const topField = tendencies[0] ? counterBookFieldLabel(tendencies[0].field) : "no clear tendency";
  return `${matchesScouted} scouted match(es) for ${teamLabel} · strongest tendency: ${topField}.`;
}
