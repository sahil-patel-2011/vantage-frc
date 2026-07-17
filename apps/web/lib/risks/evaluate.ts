// Pure risk scoring + register summary. Deterministic given its input; "now" is injected as
// `asOf` so overdue detection stays reproducible.

import type {
  MatrixCell,
  RiskCategory,
  RiskEvaluation,
  RiskLevel,
  RiskStatus,
  RiskSummary,
  TeamRisk,
} from "./types";

const CATEGORY_ORDER: RiskCategory[] = ["technical", "schedule", "funding", "logistics", "safety", "people", "other"];
const ALL_STATUSES: RiskStatus[] = ["open", "mitigating", "monitoring", "accepted", "closed"];
const ALL_LEVELS: RiskLevel[] = ["low", "moderate", "high", "critical"];

/** Statuses where a mitigation is still actively expected (so a passed due date is overdue). */
const ACTIONABLE: ReadonlySet<RiskStatus> = new Set<RiskStatus>(["open", "mitigating"]);

const clampScale = (value: number) => Math.min(5, Math.max(1, Math.round(value || 1)));
const round = (value: number, places = 2) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export function riskCategoryLabel(category: RiskCategory): string {
  const labels: Record<RiskCategory, string> = {
    technical: "Technical",
    schedule: "Schedule",
    funding: "Funding",
    logistics: "Logistics",
    safety: "Safety",
    people: "People",
    other: "Other",
  };
  return labels[category];
}

export function riskStatusLabel(status: RiskStatus): string {
  const labels: Record<RiskStatus, string> = {
    open: "Open",
    mitigating: "Mitigating",
    monitoring: "Monitoring",
    accepted: "Accepted",
    closed: "Closed",
  };
  return labels[status];
}

export function riskLevelLabel(level: RiskLevel): string {
  const labels: Record<RiskLevel, string> = {
    low: "Low",
    moderate: "Moderate",
    high: "High",
    critical: "Critical",
  };
  return labels[level];
}

export function levelForScore(score: number): RiskLevel {
  if (score >= 20) return "critical";
  if (score >= 12) return "high";
  if (score >= 6) return "moderate";
  return "low";
}

function dayDiff(fromIso: string, toIso: string): number | null {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

export function evaluateRisk(risk: TeamRisk, asOf: string = todayIso()): RiskEvaluation {
  const score = clampScale(risk.likelihood) * clampScale(risk.impact);
  const active = risk.status !== "closed";
  const daysToDue = risk.dueOn ? dayDiff(asOf, risk.dueOn) : null;
  const overdue = active && ACTIONABLE.has(risk.status) && daysToDue != null && daysToDue < 0;
  return { risk, score, level: levelForScore(score), active, overdue, daysToDue };
}

/** A 5×5 count matrix (impact rows 5→1, likelihood cols 1→5) of active risks. */
export function riskMatrix(risks: TeamRisk[], asOf: string = todayIso()): MatrixCell[] {
  const counts = new Map<string, number>();
  for (const risk of risks) {
    const evaluation = evaluateRisk(risk, asOf);
    if (!evaluation.active) continue;
    const key = `${clampScale(risk.likelihood)}:${clampScale(risk.impact)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const cells: MatrixCell[] = [];
  for (let impact = 5; impact >= 1; impact -= 1) {
    for (let likelihood = 1; likelihood <= 5; likelihood += 1) {
      const score = likelihood * impact;
      cells.push({
        likelihood,
        impact,
        score,
        level: levelForScore(score),
        count: counts.get(`${likelihood}:${impact}`) ?? 0,
      });
    }
  }
  return cells;
}

export function summarizeRisks(risks: TeamRisk[], asOf: string = todayIso()): RiskSummary {
  const evaluations = risks.map((risk) => evaluateRisk(risk, asOf));
  const active = evaluations.filter((e) => e.active);

  const byLevel = ALL_LEVELS.reduce((acc, level) => ({ ...acc, [level]: 0 }), {} as Record<RiskLevel, number>);
  for (const e of active) byLevel[e.level] += 1;

  const byStatus = ALL_STATUSES.reduce((acc, status) => ({ ...acc, [status]: 0 }), {} as Record<RiskStatus, number>);
  for (const e of evaluations) byStatus[e.risk.status] += 1;

  const catMap = new Map<RiskCategory, { active: number; scoreSum: number }>();
  for (const e of active) {
    const entry = catMap.get(e.risk.category) ?? { active: 0, scoreSum: 0 };
    entry.active += 1;
    entry.scoreSum += e.score;
    catMap.set(e.risk.category, entry);
  }
  const byCategory = [...catMap.entries()]
    .map(([category, value]) => ({
      category,
      active: value.active,
      avgScore: value.active > 0 ? round(value.scoreSum / value.active) : 0,
    }))
    .sort(
      (a, b) => b.active - a.active || b.avgScore - a.avgScore || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
    );

  const byScoreDesc = (a: RiskEvaluation, b: RiskEvaluation) =>
    b.score - a.score || b.risk.likelihood - a.risk.likelihood || a.risk.title.localeCompare(b.risk.title);

  const topRisks = [...active].sort(byScoreDesc).slice(0, 6);
  const overdue = active.filter((e) => e.overdue).sort(byScoreDesc);
  const highestScore = active.reduce((max, e) => Math.max(max, e.score), 0);
  const avgScore = active.length > 0 ? round(active.reduce((sum, e) => sum + e.score, 0) / active.length) : 0;

  return {
    total: risks.length,
    active: active.length,
    byLevel,
    byStatus,
    byCategory,
    topRisks,
    overdue,
    highestScore,
    avgScore,
  };
}

/** UTC "today" as YYYY-MM-DD. Isolated so tests inject a fixed date instead. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
