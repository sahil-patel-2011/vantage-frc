// Pure helper functions for the Goals/OKR tracker — unit-testable, no I/O.

import type { Goal, GoalCategory, GoalCheckin, GoalProgress, GoalStatus, GoalsSummary } from "./types";

export const GOAL_CATEGORIES: GoalCategory[] = [
  "build",
  "competition",
  "business",
  "team",
  "outreach",
  "other",
];

export const GOAL_STATUSES: GoalStatus[] = ["active", "completed", "abandoned"];

const CATEGORY_LABELS: Record<GoalCategory, string> = {
  build: "Build season",
  competition: "Competition",
  business: "Business",
  team: "Team & culture",
  outreach: "Outreach",
  other: "Other",
};

export function goalCategoryLabel(category: GoalCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

const STATUS_LABELS: Record<GoalStatus, string> = {
  active: "Active",
  completed: "Completed",
  abandoned: "Abandoned",
};

export function goalStatusLabel(status: GoalStatus): string {
  return STATUS_LABELS[status] ?? status;
}

/** Clamp a raw metric value into 0..1 progress against a goal's start/target range. */
export function computeProgressRatio(goal: Pick<Goal, "startValue" | "targetValue">, value: number): number {
  const span = goal.targetValue - goal.startValue;
  if (span === 0) return 0;
  const ratio = (value - goal.startValue) / span;
  return Math.max(0, Math.min(1, ratio));
}

/** Builds a per-goal progress view from its logged check-ins. Sorts check-ins newest-first. */
export function computeGoalProgress(goal: Goal, rawCheckins: GoalCheckin[], today: Date = new Date()): GoalProgress {
  const checkins = [...rawCheckins].sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1));
  const latest = checkins[0] ?? null;
  const latestValue = latest ? latest.value : null;
  const progress =
    goal.status === "completed" ? 1 : latestValue != null ? computeProgressRatio(goal, latestValue) : 0;

  const todayIso = today.toISOString().slice(0, 10);
  const overdue = goal.status === "active" && goal.dueOn != null && goal.dueOn < todayIso;

  let onTrack: boolean | null = null;
  if (goal.status === "active" && goal.dueOn && latestValue != null) {
    const created = goal.createdAt.slice(0, 10);
    const totalSpanMs = new Date(goal.dueOn).getTime() - new Date(created).getTime();
    if (totalSpanMs > 0) {
      const elapsedMs = today.getTime() - new Date(created).getTime();
      const expectedRatio = Math.max(0, Math.min(1, elapsedMs / totalSpanMs));
      onTrack = progress >= expectedRatio - 0.1;
    }
  }

  return {
    goal,
    latestValue,
    progress,
    checkinCount: checkins.length,
    lastCheckinOn: latest?.occurredOn ?? null,
    onTrack,
    overdue,
    checkins,
  };
}

export function summarizeGoals(progressRows: GoalProgress[]): GoalsSummary {
  const totalGoals = progressRows.length;
  const activeGoals = progressRows.filter((r) => r.goal.status === "active").length;
  const completedGoals = progressRows.filter((r) => r.goal.status === "completed").length;
  const abandonedGoals = progressRows.filter((r) => r.goal.status === "abandoned").length;
  const overdueGoals = progressRows.filter((r) => r.overdue).length;

  const scored = progressRows.filter((r) => r.goal.status !== "abandoned");
  const averageProgress = scored.length
    ? scored.reduce((sum, r) => sum + r.progress, 0) / scored.length
    : 0;

  const byCategoryMap = new Map<GoalCategory, { count: number; sum: number }>();
  for (const row of progressRows) {
    const entry = byCategoryMap.get(row.goal.category) ?? { count: 0, sum: 0 };
    entry.count += 1;
    entry.sum += row.progress;
    byCategoryMap.set(row.goal.category, entry);
  }
  const byCategory = GOAL_CATEGORIES.filter((c) => byCategoryMap.has(c)).map((category) => {
    const entry = byCategoryMap.get(category)!;
    return { category, count: entry.count, averageProgress: entry.sum / entry.count };
  });

  return {
    totalGoals,
    activeGoals,
    completedGoals,
    abandonedGoals,
    overdueGoals,
    averageProgress,
    byCategory,
  };
}
