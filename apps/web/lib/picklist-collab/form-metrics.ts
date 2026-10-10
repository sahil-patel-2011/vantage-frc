import {
  formFieldLowerIsBetter,
  formMetricId,
  type FormMetricId,
  type TeamMetricRow,
} from "@vantage/prediction-strategy";
import { multiCounterConfig, type FieldDefinition } from "@vantage/scouting";
import { answersToSave } from "../scouting/entry-answers";
import { combineObservations } from "../scouting/observations";

/**
 * Per-team averages of every number the team's own scouting form collects,
 * as pick-list metrics ("form:teleopCycles").
 *
 * Only real numbers count: a field a scout left blank is skipped, not zeroed.
 * Fields that read "less is better" (fouls, misses) are negated, so a positive
 * slider always means "more of what we want" — the ranking multiplies z-scores
 * by weights and has no other way to say "fewer".
 *
 * Bookkeeping keys (team, match, ids) are excluded. Original form rules
 * determine which answers count; saved reports remain untouched.
 */
const SKIP = new Set([
  "team",
  "teamNumber",
  "team_number",
  "teamKey",
  "team_key",
  "match",
  "matchNumber",
  "match_number",
  "matchKey",
  "match_key",
  "scout",
  "scoutId",
  "station",
]);

export type ScoutPayloadRow = {
  teamKey: string; matchKey?: string; payload: Record<string, unknown>;
  confidence?: "high" | "normal" | "low"; fields?: FieldDefinition[];
};
export type FormMetricSamples = Record<string, Partial<Record<FormMetricId, number>>>;
export type FormMetricDefinitions = Partial<Record<FormMetricId, { label: string; unit: string | null }>>;
const NUMERIC_TYPES = new Set(["number", "counter", "timer", "rating", "slider", "multi_counter"]);

/** A stable question key does not make different measurement types/units comparable. */
function incompatibleMetricKeys(entries: readonly ScoutPayloadRow[]): string[] {
  const signatures = new Map<string, Set<string>>();
  const numeric = new Set<string>();
  for (const entry of entries) for (const field of entry.fields ?? []) {
    if (SKIP.has(field.key) || field.key.startsWith("_")) continue;
    const known = signatures.get(field.key) ?? new Set<string>();
    const unit = typeof field.config?.unit === "string" ? field.config.unit.trim().toLowerCase() : "";
    known.add(JSON.stringify([field.type, unit])); signatures.set(field.key, known);
    if (NUMERIC_TYPES.has(field.type)) numeric.add(field.key);
  }
  return [...numeric].filter(key => (signatures.get(key)?.size ?? 0) > 1).sort();
}

export function formMetricAnalysis(entries: readonly ScoutPayloadRow[]): { rows: TeamMetricRow[]; samples: FormMetricSamples; definitions: FormMetricDefinitions; incompatibleKeys: string[] } {
  const sums = new Map<string, Map<string, { total: number; n: number }>>();
  // Reports receive equal weight within a robot/match; observed matches receive
  // equal weight within the team. Missing fields never contribute a zero.
  const trusted = entries.filter(entry => entry.confidence !== "low");
  const incompatibleKeys = incompatibleMetricKeys(trusted);
  const definitions: FormMetricDefinitions = {};
  const eligible = trusted.map(entry => {
    if (!entry.fields) return entry;
    const numericFields = entry.fields.filter(field => NUMERIC_TYPES.has(field.type) && !SKIP.has(field.key) && !incompatibleKeys.includes(field.key));
    const numericKeys = new Set(numericFields.map(field => field.key));
    for (const field of numericFields) {
      const unit = typeof field.config?.unit === "string" && field.config.unit.trim() ? field.config.unit.trim() : null;
      const parts = field.type === "multi_counter" ? multiCounterConfig(field).counters.map(counter => ({ key: `${field.key}.${counter.key}`, label: `${field.label} · ${counter.label}` })) : [field];
      for (const part of parts) definitions[formMetricId(part.key)] ??= { label: part.label, unit };
    }
    return { ...entry, payload: Object.fromEntries(Object.entries(answersToSave(entry.fields, entry.payload)).filter(([key]) => numericKeys.has(key))) };
  });
  const { rows } = combineObservations(eligible);
  for (const entry of rows) {
    if (!entry.teamKey) continue;
    const payload = entry.payload ?? {};
    for (const [key, raw] of Object.entries(payload)) {
      if (SKIP.has(key)) continue;
      if (incompatibleKeys.some(parent => key === parent || key.startsWith(`${parent}.`))) continue;
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
      const team = sums.get(entry.teamKey) ?? new Map<string, { total: number; n: number }>();
      const bucket = team.get(key) ?? { total: 0, n: 0 };
      bucket.total += raw;
      bucket.n += 1;
      team.set(key, bucket);
      sums.set(entry.teamKey, team);
    }
  }
  const metrics: TeamMetricRow[] = [];
  const samples: FormMetricSamples = {};
  for (const [teamKey, fields] of sums) {
    const values: Record<FormMetricId, number> = {};
    samples[teamKey] = {};
    for (const [key, { total, n }] of fields) {
      const mean = Math.round((total / n) * 1000) / 1000;
      values[formMetricId(key)] = formFieldLowerIsBetter(key) ? -mean : mean;
      samples[teamKey]![formMetricId(key)] = n;
    }
    metrics.push({ teamKey, values });
  }
  return { rows: metrics, samples, definitions, incompatibleKeys };
}

export function formMetricRows(entries: readonly ScoutPayloadRow[]): TeamMetricRow[] { return formMetricAnalysis(entries).rows; }

/** Add form metrics to the event rows, one row per team, never replacing a value. */
export function mergeFormMetrics(eventRows: readonly TeamMetricRow[], formRows: readonly TeamMetricRow[]): TeamMetricRow[] {
  const byKey = new Map(eventRows.map((row) => [row.teamKey, { teamKey: row.teamKey, values: { ...row.values } }]));
  for (const form of formRows) {
    const current = byKey.get(form.teamKey) ?? { teamKey: form.teamKey, values: {} };
    for (const [id, value] of Object.entries(form.values)) {
      if (current.values[id as FormMetricId] == null) current.values[id as FormMetricId] = value;
    }
    byKey.set(form.teamKey, current);
  }
  return [...byKey.values()];
}
