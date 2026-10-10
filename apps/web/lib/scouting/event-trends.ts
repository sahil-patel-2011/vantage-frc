import type { FieldDefinition } from "@vantage/scouting";
import type { ObservedRobot } from "./team-profiles";
import { scopeObservations } from "./observation-scope";
import { combineObservations } from "./observations";
import { withActivityMetrics } from "./activity-metrics";
import { climbOutcome, combineClimbOutcomes, type ClimbOutcome } from "./climb-outcome";

const unknown = (value: unknown) => value == null || (typeof value === "string" && (!value.trim() || /^(unknown|could_not_see|not_observed|not_recorded)$/i.test(value.trim())));
const supported = new Set(["number", "counter", "timer", "rating", "slider", "boolean", "select", "dropdown", "multiple_choice"]);
export type TrendMetric = { key: string; label: string; unit: string | null; type: string; incompatible: boolean };
export type TeamClimbEvidence = { teamKey: string; outcomes: Record<ClimbOutcome, number>; total: number; observed: number };
const emptyOutcomes = (): Record<ClimbOutcome, number> => ({ successful: 0, failed: 0, not_attempted: 0, no_success: 0, unseen: 0 });
const robotMatch = (row: { teamKey?: string | null; matchKey?: string | null }) => `${row.teamKey}:${row.matchKey}`;

export function eventTrendMetrics(robots: ObservedRobot[], eventKey: string, includeLow: boolean): TrendMetric[] {
  const metrics = new Map<string, TrendMetric>();
  for (const robot of robots) for (const report of scopeObservations(robot.reports, eventKey, "", includeLow).filter(report => report.matchKey).map(withActivityMetrics)) {
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
  // Preserve declared choice values such as "yes" and "no" across voting.
  // Converting them to booleans makes a majority answer invalid for its form.
  const { rows: combined, conflicts } = combineObservations(reports, { normalizeBooleanWords: false });
  const numeric = ["number", "counter", "timer", "rating", "slider"].includes(metric.type);
  // Only recognized answers for this form count; obsolete choices aren't silently pooled.
  const options = new Set(reports.flatMap(report => (report.fields ?? []).filter(field => field.key === metric.key).flatMap((field: FieldDefinition) => field.options ?? [])));
  const metricName = `${metric.key} ${metric.label}`;
  const noClimb = /climb|tower/i.test(metricName) && !/capab|ability|able|can_climb|canClimb|time|duration/i.test(metricName)
    && (!/attempt/i.test(metricName) || /result|outcome|level|success/i.test(metricName)) && !numeric;
  const askedMatches = new Set(reports.filter(report => report.fields?.some(field => field.key === metric.key)).map(robotMatch));
  const climbVotes = new Map<string, ClimbOutcome[]>();
  if (noClimb && !metric.incompatible) for (const report of reports) {
    const field = report.fields?.find(field => field.key === metric.key);
    const value = report.payload[metric.key];
    const valid = field && (field.type === "boolean" ? typeof value === "boolean" : typeof value === "string" && field.options?.includes(value));
    const key = robotMatch(report);
    const votes = climbVotes.get(key) ?? [];
    votes.push(valid ? climbOutcome(value) : "unseen");
    climbVotes.set(key, votes);
  }
  // L2 versus L3 can leave height unresolved while both scouts saw a success.
  const rows = combined.map(row => ({ ...row, climbOutcome: combineClimbOutcomes(climbVotes.get(robotMatch(row)) ?? []) }));
  const known = rows.filter(row => {
    const value = row.payload[metric.key];
    if (metric.incompatible || !askedMatches.has(robotMatch(row))) return false;
    if (noClimb) return row.climbOutcome !== "unseen";
    return !unknown(value) && (numeric ? typeof value === "number" && Number.isFinite(value) : metric.type === "boolean" ? typeof value === "boolean" : typeof value === "string" && options.has(value));
  });
  const outcomes = new Map<string, number>();
  known.forEach(row => { if (row.payload[metric.key] === undefined) return; const value = String(row.payload[metric.key]); outcomes.set(value, (outcomes.get(value) ?? 0) + 1); });
  const watchedTeams = new Set(rows.map(row => row.teamKey));
  const knownTeams = new Set(known.map(row => row.teamKey));
  const knownMatches = new Set(known.map(robotMatch));
  const climbOutcomes = emptyOutcomes();
  const teamClimbs = new Map<string, TeamClimbEvidence>();
  if (noClimb) for (const row of rows) {
    const teamKey = row.teamKey!;
    const evidence = teamClimbs.get(teamKey) ?? { teamKey, total: 0, observed: 0, outcomes: emptyOutcomes() };
    const outcome = knownMatches.has(robotMatch(row)) ? row.climbOutcome : "unseen";
    evidence.total += 1;
    if (outcome !== "unseen") evidence.observed += 1;
    evidence.outcomes[outcome] += 1;
    climbOutcomes[outcome] += 1;
    teamClimbs.set(teamKey, evidence);
  }
  const neverClimbed = [...teamClimbs.values()].filter(team => team.observed > 0 && team.outcomes.successful === 0).map(team => team.teamKey);
  const summarize = (group: typeof known) => ({ answered: group.length, value: group.length ? group.reduce((sum, row) => sum + (numeric ? Number(row.payload[metric.key]) : noClimb ? Number(row.climbOutcome === "successful") : Number(row.payload[metric.key] === true)), 0) / group.length : null });
  const quals = [...new Set(rows.map(row => qualificationNumber(row.matchKey)).filter((value): value is number => value !== null))].sort((a,b) => a-b);
  const midpoint = quals.length >= 4 ? quals[Math.ceil(quals.length / 2) - 1]! : null;
  const recent = midpoint === null ? null : {
    early: summarize(known.filter(row => { const n = qualificationNumber(row.matchKey); return n !== null && n <= midpoint; })),
    late: summarize(known.filter(row => { const n = qualificationNumber(row.matchKey); return n !== null && n > midpoint; })),
    earlyLabel: `Q${quals[0]}–Q${midpoint}`, lateLabel: `Q${quals[quals.indexOf(midpoint) + 1]}–Q${quals.at(-1)}`,
  };
  return { total: rows.length, answered: known.length, missing: rows.length - known.length, watchedTeams: watchedTeams.size, knownTeams: knownTeams.size,
    disagreements: conflicts.filter(conflict => conflict.field === metric.key).length, noClimb, neverClimbed, outcomes: [...outcomes].sort((a,b) => b[1]-a[1]),
    climbOutcomes, teamClimbs: [...teamClimbs.values()].sort((a,b) => a.teamKey.localeCompare(b.teamKey, undefined, { numeric: true })),
    unasked: rows.filter(row => !askedMatches.has(robotMatch(row))).length,
    mean: numeric ? summarize(known).value : null, recent, rows: known, reports: reports.length };
}
