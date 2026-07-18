// Pure incident evaluation + summary. Deterministic given its input; "now" is injected as
// `asOf` so overdue / days-open stay reproducible.

import type {
  Incident,
  IncidentCategory,
  IncidentEvaluation,
  IncidentSeverity,
  IncidentStatus,
  IncidentsSummary,
} from "./types";

const CATEGORY_ORDER: IncidentCategory[] = [
  "injury",
  "near_miss",
  "equipment",
  "electrical",
  "chemical",
  "property",
  "other",
];
const ALL_SEVERITIES: IncidentSeverity[] = ["minor", "moderate", "serious", "critical"];
const ALL_STATUSES: IncidentStatus[] = ["open", "investigating", "action_pending", "resolved", "closed"];

const SEVERITY_RANK: Record<IncidentSeverity, number> = { critical: 4, serious: 3, moderate: 2, minor: 1 };
const RESOLVED: ReadonlySet<IncidentStatus> = new Set<IncidentStatus>(["resolved", "closed"]);

const round = (value: number, places = 1) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export function incidentCategoryLabel(category: IncidentCategory): string {
  const labels: Record<IncidentCategory, string> = {
    injury: "Injury",
    near_miss: "Near miss",
    equipment: "Equipment",
    electrical: "Electrical",
    chemical: "Chemical",
    property: "Property",
    other: "Other",
  };
  return labels[category];
}

export function incidentSeverityLabel(severity: IncidentSeverity): string {
  const labels: Record<IncidentSeverity, string> = {
    minor: "Minor",
    moderate: "Moderate",
    serious: "Serious",
    critical: "Critical",
  };
  return labels[severity];
}

export function incidentStatusLabel(status: IncidentStatus): string {
  const labels: Record<IncidentStatus, string> = {
    open: "Open",
    investigating: "Investigating",
    action_pending: "Action pending",
    resolved: "Resolved",
    closed: "Closed",
  };
  return labels[status];
}

export function severityRank(severity: IncidentSeverity): number {
  return SEVERITY_RANK[severity];
}

function dayDiff(fromIso: string, toIso: string): number | null {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

export function evaluateIncident(incident: Incident, asOf: string = todayIso()): IncidentEvaluation {
  const isOpen = !RESOLVED.has(incident.status);
  const daysToDue = incident.dueOn ? dayDiff(asOf, incident.dueOn) : null;
  const overdue = isOpen && daysToDue != null && daysToDue < 0;
  const daysOpen = isOpen ? Math.max(0, dayDiff(incident.occurredOn, asOf) ?? 0) : null;
  return { incident, isOpen, overdue, daysToDue, daysOpen };
}

export function summarizeIncidents(incidents: Incident[], asOf: string = todayIso()): IncidentsSummary {
  const evaluations = incidents.map((incident) => evaluateIncident(incident, asOf));
  const open = evaluations.filter((e) => e.isOpen);

  const bySeverity = ALL_SEVERITIES.reduce(
    (acc, severity) => ({ ...acc, [severity]: 0 }),
    {} as Record<IncidentSeverity, number>,
  );
  for (const e of open) bySeverity[e.incident.severity] += 1;

  const byStatus = ALL_STATUSES.reduce((acc, status) => ({ ...acc, [status]: 0 }), {} as Record<IncidentStatus, number>);
  for (const e of evaluations) byStatus[e.incident.status] += 1;

  const catMap = new Map<IncidentCategory, number>();
  for (const e of open) catMap.set(e.incident.category, (catMap.get(e.incident.category) ?? 0) + 1);
  const byCategory = [...catMap.entries()]
    .map(([category, count]) => ({ category, open: count }))
    .sort((a, b) => b.open - a.open || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));

  const bySeverityDesc = (a: IncidentEvaluation, b: IncidentEvaluation) =>
    severityRank(b.incident.severity) - severityRank(a.incident.severity);

  const overdue = open
    .filter((e) => e.overdue)
    .sort((a, b) => bySeverityDesc(a, b) || (a.daysToDue ?? 0) - (b.daysToDue ?? 0));

  const priority = open
    .filter((e) => e.incident.severity === "serious" || e.incident.severity === "critical")
    .sort((a, b) => bySeverityDesc(a, b) || b.incident.occurredOn.localeCompare(a.incident.occurredOn));

  const avgDaysOpen = open.length > 0 ? round(open.reduce((sum, e) => sum + (e.daysOpen ?? 0), 0) / open.length) : 0;

  return {
    total: incidents.length,
    open: open.length,
    bySeverity,
    byStatus,
    byCategory,
    overdue,
    priority,
    avgDaysOpen,
  };
}

/** UTC "today" as YYYY-MM-DD. Isolated so tests inject a fixed date instead. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
