import {
  formFieldLowerIsBetter,
  formMetricId,
  type FormMetricId,
  type TeamMetricRow,
} from "@vantage/prediction-strategy";

/**
 * Per-team averages of every number the team's own scouting form collects,
 * as pick-list metrics ("form:teleopCycles").
 *
 * Only real numbers count: a field a scout left blank is skipped, not zeroed.
 * Fields that read "less is better" (fouls, misses) are negated, so a positive
 * slider always means "more of what we want" — the ranking multiplies z-scores
 * by weights and has no other way to say "fewer".
 *
 * Keys that are bookkeeping rather than performance (team, match, ids) and
 * totals already covered by built-in metrics are left out, so the sliders are
 * the form's own measurements.
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

export type ScoutPayloadRow = { teamKey: string; payload: Record<string, unknown> };

export function formMetricRows(entries: readonly ScoutPayloadRow[]): TeamMetricRow[] {
  const sums = new Map<string, Map<string, { total: number; n: number }>>();
  for (const entry of entries) {
    const payload = entry.payload ?? {};
    for (const [key, raw] of Object.entries(payload)) {
      if (SKIP.has(key)) continue;
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
      const team = sums.get(entry.teamKey) ?? new Map<string, { total: number; n: number }>();
      const bucket = team.get(key) ?? { total: 0, n: 0 };
      bucket.total += raw;
      bucket.n += 1;
      team.set(key, bucket);
      sums.set(entry.teamKey, team);
    }
  }
  const rows: TeamMetricRow[] = [];
  for (const [teamKey, fields] of sums) {
    const values: Record<FormMetricId, number> = {};
    for (const [key, { total, n }] of fields) {
      const mean = Math.round((total / n) * 1000) / 1000;
      values[formMetricId(key)] = formFieldLowerIsBetter(key) ? -mean : mean;
    }
    rows.push({ teamKey, values });
  }
  return rows;
}

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
