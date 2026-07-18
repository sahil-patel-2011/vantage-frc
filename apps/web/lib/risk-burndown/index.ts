// Pure, unit-testable helpers for the risk-burndown feature. No I/O, no framework imports.

export * from "./types";
import type {
  RiskBurndownPoint,
  RiskCategory,
  RiskItem,
  RiskSeverityBand,
  RiskStatus,
  RiskSummary,
} from "./types";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export const RISK_CATEGORIES: RiskCategory[] = [
  "technical",
  "schedule",
  "budget",
  "personnel",
  "logistics",
  "safety",
  "other",
];

export const RISK_STATUSES: RiskStatus[] = ["open", "mitigating", "closed", "accepted"];

const CATEGORY_LABELS: Record<RiskCategory, string> = {
  technical: "Technical",
  schedule: "Schedule",
  budget: "Budget",
  personnel: "Personnel",
  logistics: "Logistics",
  safety: "Safety",
  other: "Other",
};

const STATUS_LABELS: Record<RiskStatus, string> = {
  open: "Open",
  mitigating: "Mitigating",
  closed: "Closed",
  accepted: "Accepted",
};

export function riskCategoryLabel(category: RiskCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function riskStatusLabel(status: RiskStatus): string {
  return STATUS_LABELS[status] ?? status;
}

/** likelihood * impact, clamped to the valid 1..25 range. */
export function severityOf(likelihood: number, impact: number): number {
  const l = Math.min(5, Math.max(1, Math.round(likelihood) || 1));
  const i = Math.min(5, Math.max(1, Math.round(impact) || 1));
  return l * i;
}

export function severityBandOf(severity: number): RiskSeverityBand {
  if (severity >= 20) return "critical";
  if (severity >= 12) return "high";
  if (severity >= 6) return "medium";
  return "low";
}

/** A risk counts as "resolved" (no longer open on the burndown) once closed or accepted. */
export function isResolved(status: RiskStatus): boolean {
  return status === "closed" || status === "accepted";
}

export function summarizeRisks(risks: RiskItem[]): RiskSummary {
  if (risks.length === 0) {
    return {
      totalRisks: 0,
      openRisks: 0,
      mitigatingRisks: 0,
      closedRisks: 0,
      acceptedRisks: 0,
      avgSeverity: 0,
      highSeverityOpenCount: 0,
      byCategory: [],
      byStatus: [],
      bySeverityBand: [],
      burndownSignal: 0,
    };
  }

  const openRisks = risks.filter((r) => r.status === "open").length;
  const mitigatingRisks = risks.filter((r) => r.status === "mitigating").length;
  const closedRisks = risks.filter((r) => r.status === "closed").length;
  const acceptedRisks = risks.filter((r) => r.status === "accepted").length;

  const avgSeverity = round(risks.reduce((sum, r) => sum + r.severity, 0) / risks.length, 2);

  const highSeverityOpenCount = risks.filter(
    (r) => !isResolved(r.status) && (r.severityBand === "high" || r.severityBand === "critical"),
  ).length;

  const byCategory = RISK_CATEGORIES.map((category) => {
    const rows = risks.filter((r) => r.category === category);
    return {
      category,
      count: rows.length,
      avgSeverity: rows.length ? round(rows.reduce((sum, r) => sum + r.severity, 0) / rows.length, 2) : 0,
    };
  }).filter((row) => row.count > 0);

  const byStatus = RISK_STATUSES.map((status) => ({
    status,
    count: risks.filter((r) => r.status === status).length,
  })).filter((row) => row.count > 0);

  const bandOrder: RiskSeverityBand[] = ["critical", "high", "medium", "low"];
  const bySeverityBand = bandOrder
    .map((band) => ({ band, count: risks.filter((r) => r.severityBand === band).length }))
    .filter((row) => row.count > 0);

  const resolvedShare = clamp01((closedRisks + acceptedRisks) / risks.length);
  const criticalPenalty = clamp01(highSeverityOpenCount / risks.length);
  const burndownSignal = round(clamp01(0.7 * resolvedShare + 0.3 * (1 - criticalPenalty)));

  return {
    totalRisks: risks.length,
    openRisks,
    mitigatingRisks,
    closedRisks,
    acceptedRisks,
    avgSeverity,
    highSeverityOpenCount,
    byCategory,
    byStatus,
    bySeverityBand,
    burndownSignal,
  };
}

function toDateOnly(iso: string): string {
  return iso.length > 10 ? iso.slice(0, 10) : iso;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * Daily open-risk count from the earliest identified date through today, so the register's
 * burndown can be plotted. A risk is "open" on a given day if it was identified on/before that
 * day and (not resolved) or (resolved after that day).
 */
export function computeRiskBurndownSeries(risks: RiskItem[], referenceDate: Date = new Date()): RiskBurndownPoint[] {
  if (risks.length === 0) return [];

  const identifiedDates = risks.map((r) => toDateOnly(r.identifiedOn)).sort();
  const start = new Date(`${identifiedDates[0]}T00:00:00.000Z`);
  const todayStr = toDateOnly(referenceDate.toISOString());
  const end = new Date(`${todayStr}T00:00:00.000Z`);
  if (end.getTime() < start.getTime()) return [];

  const maxPoints = 366;
  const totalDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const step = Math.max(1, Math.ceil(totalDays / maxPoints));

  const points: RiskBurndownPoint[] = [];
  for (let offset = 0; offset <= totalDays; offset += step) {
    const day = addDays(start, offset);
    const dayStr = day.toISOString().slice(0, 10);
    const openCount = risks.filter((r) => {
      const identified = toDateOnly(r.identifiedOn);
      if (identified > dayStr) return false;
      if (!isResolved(r.status)) return true;
      const closed = r.closedOn ? toDateOnly(r.closedOn) : null;
      return closed != null && closed > dayStr;
    }).length;
    points.push({ date: dayStr, openCount });
  }
  if (points[points.length - 1]?.date !== todayStr) {
    const openCount = risks.filter((r) => {
      const identified = toDateOnly(r.identifiedOn);
      if (identified > todayStr) return false;
      if (!isResolved(r.status)) return true;
      const closed = r.closedOn ? toDateOnly(r.closedOn) : null;
      return closed != null && closed > todayStr;
    }).length;
    points.push({ date: todayStr, openCount });
  }
  return points;
}
