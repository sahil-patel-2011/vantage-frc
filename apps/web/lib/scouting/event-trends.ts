import type { FieldDefinition } from "@vantage/scouting";
import type { ObservedRobot } from "./team-profiles";
import { scopeObservations } from "./observation-scope";
import { combineObservations } from "./observations";
import { withActivityMetrics } from "./activity-metrics";

const unknown = (value: unknown) => value == null || value === "" || (typeof value === "string" && /^(unknown|could_not_see|not_observed|not_recorded)$/i.test(value));
const none = (value: unknown) => value === false || value === 0 || (typeof value === "string" && /^(none|no|false|did_not_climb|no_climb|not_attempted|park|parked|failed|attempted_failed)$/i.test(value));
const supported = new Set(["number", "counter", "timer", "rating", "slider", "boolean", "select", "dropdown", "multiple_choice"]);
export type TrendMetric = { key: string; label: string; unit: string | null; type: string; incompatible: boolean };

export function eventTrendMetrics(robots: ObservedRobot[], eventKey: string, includeLow: boolean): TrendMetric[] {
  const metrics = new Map<string, TrendMetric>();
  for (const robot of robots) for (const report of scopeObservations(robot.reports, eventKey, "", includeLow).map(withActivityMetrics)) {
    for (const field of report.fields ?? []) {
      if (!supported.has(field.type) || field.key.startsWith("_")) continue;
      const unit = typeof field.config?.unit === "string" ? field.config.unit : null;
      const prior = metrics.get(field.key);
      metrics.set(field.key, { key: field.key, label: field.label, type: field.type, unit, incompatible: Boolean(prior?.incompatible || (prior && (prior.unit !== unit || prior.type !== field.type))) });
    }
  }
  return [...metrics.values()];
}

function qualificationNumber(key: string | null | undefined): number | null {
  const found = key?.match(/_qm(\d+)$/); return found ? Number(found[1]) : null;
}

/** Outcome frequencies, not intentions. Every robot/match is counted once. */
export function buildEventTrend(robots: ObservedRobot[], eventKey: string, metric: TrendMetric, includeLow: boolean) {
  const reports = robots.flatMap(robot => scopeObservations(robot.reports, eventKey, "", includeLow).filter(report => report.matchKey).map(report => ({ ...withActivityMetrics(report), teamKey: robot.teamKey })));
  const { rows, conflicts } = combineObservations(reports);
  const numeric = ["number", "counter", "timer", "rating", "slider"].includes(metric.type);
  // Only recognized answers for this form count; obsolete choices aren't silently pooled.
  const options = new Set(reports.flatMap(report => (report.fields ?? []).filter(field => field.key === metric.key).flatMap((field: FieldDefinition) => field.options ?? [])));
  const noClimb = /climb|tower/i.test(`${metric.key} ${metric.label}`) && !numeric;
  const known = rows.filter(row => {
    const value = row.payload[metric.key];
    return !metric.incompatible && !unknown(value) && (!noClimb || none(value) || value === true || (typeof value === "string" && /^(L[1-3]|deep|shallow|high|low|climbed|success|yes)$/i.test(value))) && (numeric ? typeof value === "number" && Number.isFinite(value) : metric.type === "boolean" ? typeof value === "boolean" : typeof value === "string" && options.has(value));
  });
  const outcomes = new Map<string, number>();
  known.forEach(row => { const value = String(row.payload[metric.key]); outcomes.set(value, (outcomes.get(value) ?? 0) + 1); });
  const watchedTeams = new Set(rows.map(row => row.teamKey));
  const knownTeams = new Set(known.map(row => row.teamKey));
  const neverClimbed = [...knownTeams].filter(team => known.filter(row => row.teamKey === team).every(row => none(row.payload[metric.key])));
  const summarize = (group: typeof known) => ({ answered: group.length, value: group.length ? group.reduce((sum, row) => sum + (numeric ? Number(row.payload[metric.key]) : none(row.payload[metric.key]) ? 0 : 1), 0) / group.length : null });
  const quals = [...new Set(rows.map(row => qualificationNumber(row.matchKey)).filter((value): value is number => value !== null))].sort((a,b) => a-b);
  const midpoint = quals.length >= 4 ? quals[Math.ceil(quals.length / 2) - 1]! : null;
  const recent = midpoint === null ? null : {
    early: summarize(known.filter(row => { const n = qualificationNumber(row.matchKey); return n !== null && n <= midpoint; })),
    late: summarize(known.filter(row => { const n = qualificationNumber(row.matchKey); return n !== null && n > midpoint; })),
    earlyLabel: `Q${quals[0]}–Q${midpoint}`, lateLabel: `Q${quals[quals.indexOf(midpoint) + 1]}–Q${quals.at(-1)}`,
  };
  return { total: rows.length, answered: known.length, missing: rows.length - known.length, watchedTeams: watchedTeams.size, knownTeams: knownTeams.size,
    disagreements: conflicts.filter(conflict => conflict.field === metric.key).length, noClimb, neverClimbed, outcomes: [...outcomes].sort((a,b) => b[1]-a[1]),
    mean: numeric ? summarize(known).value : null, recent, rows: known, reports: reports.length };
}
