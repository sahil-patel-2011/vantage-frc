// Pure goal evaluation + season scorecard. Deterministic given its input; "now" is injected
// as `asOf` so status derivation (at-risk / missed by due date) stays reproducible.

import type {
  CategoryRollup,
  GoalCategory,
  GoalEvaluation,
  GoalPriority,
  GoalStatus,
  GoalsSummary,
  MetricType,
  SeasonGoal,
} from "./types";

const CATEGORY_ORDER: GoalCategory[] = ["competition", "technical", "outreach", "business", "team", "other"];
const ALL_STATUSES: GoalStatus[] = ["not_started", "in_progress", "at_risk", "achieved", "missed"];

const PRIORITY_WEIGHT: Record<GoalPriority, number> = { high: 3, normal: 2, low: 1 };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export function goalCategoryLabel(category: GoalCategory): string {
  const labels: Record<GoalCategory, string> = {
    competition: "Competition",
    technical: "Technical",
    outreach: "Outreach",
    business: "Business",
    team: "Team",
    other: "Other",
  };
  return labels[category];
}

export function metricTypeLabel(metric: MetricType): string {
  const labels: Record<MetricType, string> = {
    percent: "Percent",
    count: "Count",
    currency: "Dollars",
    binary: "Yes / no",
  };
  return labels[metric];
}

export function goalStatusLabel(status: GoalStatus): string {
  const labels: Record<GoalStatus, string> = {
    not_started: "Not started",
    in_progress: "In progress",
    at_risk: "At risk",
    achieved: "Achieved",
    missed: "Missed",
  };
  return labels[status];
}

/** Format a goal's current/target for display (e.g. "45 / 80 hours", "$12,000 / $15,000", "Done"). */
export function formatGoalValue(goal: SeasonGoal): string {
  if (goal.metricType === "binary") return goal.currentValue >= 1 ? "Done" : "Not done";
  if (goal.metricType === "currency") {
    const fmt = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    return `${fmt(goal.currentValue)} / ${fmt(goal.targetValue)}`;
  }
  const suffix = goal.metricType === "percent" ? "%" : goal.unit ? ` ${goal.unit}` : "";
  return `${goal.currentValue} / ${goal.targetValue}${suffix}`;
}

function progressOf(goal: SeasonGoal): number {
  if (goal.metricType === "binary") return goal.currentValue >= 1 ? 1 : 0;
  if (goal.targetValue > 0) return clamp01(goal.currentValue / goal.targetValue);
  // No positive target set: treat any progress as complete, otherwise not started.
  return goal.currentValue > 0 ? 1 : 0;
}

function dayDiff(fromIso: string, toIso: string): number | null {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

export function evaluateGoal(goal: SeasonGoal, asOf: string = todayIso()): GoalEvaluation {
  const progress = round(progressOf(goal));
  const daysToDue = goal.dueOn ? dayDiff(asOf, goal.dueOn) : null;

  let status: GoalStatus;
  if (progress >= 1) status = "achieved";
  else if (daysToDue != null && daysToDue < 0) status = "missed";
  else if (daysToDue != null && daysToDue <= 14 && progress < 0.7) status = "at_risk";
  else if (progress > 0) status = "in_progress";
  else status = "not_started";

  return { goal, progress, status, daysToDue };
}

export function summarizeGoals(goals: SeasonGoal[], asOf: string = todayIso()): GoalsSummary {
  const evaluations = goals.map((goal) => evaluateGoal(goal, asOf));

  const statusCounts = ALL_STATUSES.reduce(
    (acc, status) => ({ ...acc, [status]: 0 }),
    {} as Record<GoalStatus, number>,
  );
  for (const evaluation of evaluations) statusCounts[evaluation.status] += 1;

  const total = goals.length;
  const achieved = statusCounts.achieved;
  const avgProgress = total > 0 ? round(evaluations.reduce((sum, e) => sum + e.progress, 0) / total) : 0;

  let weightSum = 0;
  let weightedProgressSum = 0;
  for (const evaluation of evaluations) {
    const weight = PRIORITY_WEIGHT[evaluation.goal.priority];
    weightSum += weight;
    weightedProgressSum += evaluation.progress * weight;
  }
  const weightedProgress = weightSum > 0 ? round(weightedProgressSum / weightSum) : 0;

  const catMap = new Map<GoalCategory, { total: number; achieved: number; progressSum: number }>();
  for (const evaluation of evaluations) {
    const key = evaluation.goal.category;
    const entry = catMap.get(key) ?? { total: 0, achieved: 0, progressSum: 0 };
    entry.total += 1;
    if (evaluation.status === "achieved") entry.achieved += 1;
    entry.progressSum += evaluation.progress;
    catMap.set(key, entry);
  }
  const byCategory: CategoryRollup[] = [...catMap.entries()]
    .map(([category, value]) => ({
      category,
      total: value.total,
      achieved: value.achieved,
      avgProgress: value.total > 0 ? round(value.progressSum / value.total) : 0,
    }))
    .sort(
      (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.category.localeCompare(b.category),
    );

  const rank: Record<GoalStatus, number> = { missed: 0, at_risk: 1, not_started: 2, in_progress: 3, achieved: 4 };
  const needsAttention = evaluations
    .filter((e) => e.status === "at_risk" || e.status === "missed")
    .sort((a, b) => {
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      const ad = a.daysToDue ?? Number.POSITIVE_INFINITY;
      const bd = b.daysToDue ?? Number.POSITIVE_INFINITY;
      return ad - bd;
    });

  return {
    total,
    achieved,
    achievedPct: total > 0 ? round(achieved / total) : 0,
    avgProgress,
    weightedProgress,
    statusCounts,
    byCategory,
    needsAttention,
  };
}

/** UTC "today" as YYYY-MM-DD. Isolated so tests inject a fixed date instead. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
