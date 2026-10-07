import { validatePayload, type FieldDefinition } from "@vantage/scouting";
import type { ObservedRobot } from "./team-profiles";
import { scopeObservations } from "./observation-scope";
import { observationFields, type ObservationRow } from "./observations";
import { withActivityMetrics } from "./activity-metrics";

const words = (value: string) => value.trim().replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
const unknown = (value: unknown) => value == null || (typeof value === "string" && /^(|unknown|could not see|not observed|not recorded|not applicable)$/.test(words(value)));
const noAttempt = (value: unknown) => typeof value === "string" && /^(not attempted|did not attempt|did not try|no attempt)$/.test(words(value));
/** Unknown custom choices still appear as outcomes, but never imply climb success. */
function climbOutcome(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const text = words(value);
  if (/^(none|no|false|did not climb|no climb|not attempted|did not attempt|did not try|no attempt|park|parked|failed|attempted failed)$/.test(text)) return false;
  if (/^(l[1-3]|level [1-3]|deep|shallow|high|low|climb|climbed|success|successful|yes|true)$/.test(text)) return true;
  return null;
}
const supported = new Set(["number", "counter", "timer", "rating", "slider", "boolean", "select", "dropdown", "multiple_choice"]);
export type TrendMetric = { key: string; label: string; unit: string | null; type: string; incompatible: boolean; multiple?: boolean };

export function eventTrendMetrics(robots: ObservedRobot[], eventKey: string, includeLow: boolean): TrendMetric[] {
  const metrics = new Map<string, TrendMetric>();
  for (const robot of robots) for (const report of scopeObservations(robot.reports, eventKey, "", includeLow).filter(report => report.matchKey).map(withActivityMetrics)) {
    for (const field of report.fields ?? []) {
      if (!supported.has(field.type) || field.key.startsWith("_")) continue;
      const unit = typeof field.config?.unit === "string" ? field.config.unit : null;
      const prior = metrics.get(field.key);
      const multiple = (field.type === "multiple_choice" && field.config?.allowMultiple === true) || (field.type === "timer" && field.config?.mode === "lap");
      metrics.set(field.key, { key: field.key, label: field.label, type: field.type, unit, multiple, incompatible: Boolean(prior?.incompatible || (prior && (prior.unit !== unit || prior.type !== field.type || prior.multiple !== multiple))) });
    }
  }
  return [...metrics.values()].filter(metric => !metric.multiple || metric.incompatible);
}

function qualificationNumber(key: string | null | undefined): number | null {
  const found = key?.match(/_qm(\d+)$/); return found ? Number(found[1]) : null;
}

/** Outcome frequencies, not intentions. Every robot/match is counted once. */
export function buildEventTrend(robots: ObservedRobot[], eventKey: string, metric: TrendMetric, includeLow: boolean) {
  const reports = robots.flatMap(robot => scopeObservations(robot.reports, eventKey, "", includeLow).filter(report => report.matchKey).map(report => ({ ...withActivityMetrics(report), teamKey: robot.teamKey })));
  const numeric = ["number", "counter", "timer", "rating", "slider"].includes(metric.type);
  // Validate against the report's own form before reducing duplicates. An invalid
  // choice from one version must not become valid because another form offers it.
  const groups = new Map<string, { row: ObservationRow; values: Array<string | number | boolean> }>();
  for (const report of reports) {
    const key = `${report.teamKey}:${report.matchKey}`;
    const group = groups.get(key) ?? { row: { teamKey: report.teamKey, matchKey: report.matchKey, payload: {} }, values: [] };
    groups.set(key, group);
    const field: FieldDefinition | undefined = report.fields?.find(field => field.key === metric.key);
    const value = observationFields(report.payload)[metric.key];
    if (!field || metric.incompatible || metric.multiple || unknown(value)) continue;
    const valid = numeric ? typeof value === "number" && Number.isFinite(value) && validatePayload({ title: "Trend", fields: [{ ...field, visibleWhen: undefined, config: { ...field.config, visibleWhen: undefined } }] }, { [metric.key]: value }).length === 0
      : metric.type === "boolean" ? typeof value === "boolean"
      : typeof value === "string" && Boolean(field.options?.includes(value));
    if (valid) group.values.push(value as string | number | boolean);
  }
  let disagreements = 0;
  const rows = [...groups.values()].map(({ row, values }) => {
    const votes = new Map<string | number | boolean, number>();
    values.forEach(value => votes.set(value, (votes.get(value) ?? 0) + 1));
    if (votes.size > 1) disagreements++;
    if (values.length && numeric) row.payload[metric.key] = values.reduce<number>((sum, value) => sum + Number(value) / values.length, 0);
    else {
      const ordered = [...votes].sort((a, b) => b[1] - a[1]);
      if (ordered[0] && ordered[0][1] > (ordered[1]?.[1] ?? 0)) row.payload[metric.key] = ordered[0][0];
    }
    return row;
  }).sort((a, b) => (qualificationNumber(a.matchKey) ?? Infinity) - (qualificationNumber(b.matchKey) ?? Infinity) || (a.matchKey ?? "").localeCompare(b.matchKey ?? "", undefined, { numeric: true }) || (a.teamKey ?? "").localeCompare(b.teamKey ?? "", undefined, { numeric: true }));
  const known = rows.filter(row => row.payload[metric.key] !== undefined);
  const metricName = words(`${metric.key} ${metric.label}`);
  const climbMetric = /climb|tower/.test(metricName) && !numeric;
  const attemptMetric = climbMetric && /attempt|try|tried/.test(metricName) && !/can |capab|plan|intent|want|strategy/.test(metricName);
  const noClimb = climbMetric && !/attempt|try|tried|can |capab|plan|intent|want|strategy|partner/.test(metricName) && known.length > 0 && known.every(row => climbOutcome(row.payload[metric.key]) !== null);
  const outcomes = new Map<string, number>();
  known.forEach(row => { const value = String(row.payload[metric.key]); outcomes.set(value, (outcomes.get(value) ?? 0) + 1); });
  const watchedTeams = new Set(rows.map(row => row.teamKey));
  const knownTeams = new Set(known.map(row => row.teamKey));
  const climbedTeams = new Set(known.filter(row => climbOutcome(row.payload[metric.key]) === true).map(row => row.teamKey));
  const neverClimbed = noClimb ? [...knownTeams].filter(team => !climbedTeams.has(team)) : [];
  const notAttempted = climbMetric ? known.filter(row => noAttempt(row.payload[metric.key]) || (attemptMetric && (row.payload[metric.key] === false || (typeof row.payload[metric.key] === "string" && /^(no|false)$/.test(words(String(row.payload[metric.key]))))))).length : 0;
  const summarize = (group: typeof rows) => {
    const answered = group.filter(row => row.payload[metric.key] !== undefined);
    return { total: group.length, teams: new Set(answered.map(row => row.teamKey)).size, answered: answered.length,
      value: answered.length ? answered.reduce((sum, row) => sum + (numeric ? Number(row.payload[metric.key]) : noClimb ? Number(climbOutcome(row.payload[metric.key])) : Number(row.payload[metric.key] === true)) / answered.length, 0) : null };
  };
  const quals = [...new Set(rows.map(row => qualificationNumber(row.matchKey)).filter((value): value is number => value !== null))].sort((a,b) => a-b);
  const midpoint = quals.length >= 4 ? quals[Math.ceil(quals.length / 2) - 1]! : null;
  const recent = midpoint === null ? null : {
    early: summarize(rows.filter(row => { const n = qualificationNumber(row.matchKey); return n !== null && n <= midpoint; })),
    late: summarize(rows.filter(row => { const n = qualificationNumber(row.matchKey); return n !== null && n > midpoint; })),
    earlyLabel: `Q${quals[0]}–Q${midpoint}`, lateLabel: `Q${quals[quals.indexOf(midpoint) + 1]}–Q${quals.at(-1)}`,
  };
  return { total: rows.length, answered: known.length, missing: rows.length - known.length, watchedTeams: watchedTeams.size, knownTeams: knownTeams.size,
    disagreements, noClimb, neverClimbed, notAttempted, outcomes: [...outcomes].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])),
    mean: numeric ? summarize(known).value : null, recent, rows: known, reports: reports.length };
}
