// Pure helper functions for build-season burndown — no I/O, unit-testable.

import type {
  BuildBurndownPlan,
  BuildBurndownSummary,
  BuildBurndownTask,
  BuildTaskCategory,
  BuildTaskStatus,
  BurndownPoint,
} from "./types";

export const BUILD_TASK_CATEGORIES: BuildTaskCategory[] = [
  "mechanical",
  "electrical",
  "software",
  "drivetrain",
  "autonomous",
  "other",
];

export const BUILD_TASK_STATUSES: BuildTaskStatus[] = ["pending", "in_progress", "done", "blocked"];

export function buildTaskCategoryLabel(category: BuildTaskCategory): string {
  switch (category) {
    case "mechanical":
      return "Mechanical";
    case "electrical":
      return "Electrical";
    case "software":
      return "Software";
    case "drivetrain":
      return "Drivetrain";
    case "autonomous":
      return "Autonomous";
    default:
      return "Other";
  }
}

export function buildTaskStatusLabel(status: BuildTaskStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "in_progress":
      return "In progress";
    case "done":
      return "Done";
    default:
      return "Blocked";
  }
}

function toUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Summarizes the current task set: totals, breakdowns, and pace vs. the plan line. */
export function summarizeBurndown(
  tasks: BuildBurndownTask[],
  plan: BuildBurndownPlan | null,
  today: Date = new Date(),
): BuildBurndownSummary {
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === "done").length;
  const blockedTasks = tasks.filter((t) => t.status === "blocked").length;
  const remainingTasks = totalTasks - completedTasks;
  const todayIso = isoOf(today);
  const overdueTasks = tasks.filter(
    (t) => t.status !== "done" && t.plannedDate < todayIso,
  ).length;
  const percentComplete = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) / 100 : 0;

  const byCategoryMap = new Map<BuildTaskCategory, { total: number; completed: number }>();
  for (const category of BUILD_TASK_CATEGORIES) byCategoryMap.set(category, { total: 0, completed: 0 });
  for (const task of tasks) {
    const bucket = byCategoryMap.get(task.category) ?? { total: 0, completed: 0 };
    bucket.total += 1;
    if (task.status === "done") bucket.completed += 1;
    byCategoryMap.set(task.category, bucket);
  }
  const byCategory = BUILD_TASK_CATEGORIES.map((category) => ({
    category,
    ...(byCategoryMap.get(category) ?? { total: 0, completed: 0 }),
  })).filter((row) => row.total > 0);

  let paceSignal = 0;
  if (plan && totalTasks > 0) {
    const series = computeBurndownSeries(tasks, plan, today);
    const todayPoint = series.find((p) => p.date === todayIso) ?? series[series.length - 1];
    if (todayPoint && todayPoint.actual != null) {
      const diff = todayPoint.planned - todayPoint.actual;
      paceSignal = Math.max(-1, Math.min(1, diff / totalTasks));
    }
  }

  return {
    totalTasks,
    completedTasks,
    remainingTasks,
    blockedTasks,
    overdueTasks,
    percentComplete,
    byCategory,
    paceSignal,
  };
}

/**
 * Builds the burndown series between kickoff and competition day: the ideal "planned remaining"
 * line (tasks whose planned date has not yet passed) alongside the "actual remaining" line
 * (tasks not yet completed as of each date, only populated through today).
 */
export function computeBurndownSeries(
  tasks: BuildBurndownTask[],
  plan: BuildBurndownPlan,
  today: Date = new Date(),
): BurndownPoint[] {
  const start = toUtcDate(plan.kickoffDate);
  const end = toUtcDate(plan.competitionDate);
  if (end.getTime() < start.getTime() || tasks.length === 0) return [];

  const todayIso = isoOf(today);
  const totalTasks = tasks.length;
  const points: BurndownPoint[] = [];
  const maxDays = 400; // guard against runaway ranges
  let cursor = start;
  let iterations = 0;
  while (cursor.getTime() <= end.getTime() && iterations < maxDays) {
    const dateIso = isoOf(cursor);
    const planned = tasks.filter((t) => t.plannedDate >= dateIso).length;
    const actual =
      dateIso <= todayIso ? tasks.filter((t) => !t.completedOn || t.completedOn >= dateIso).length : null;
    points.push({ date: dateIso, planned, actual });
    cursor = addDays(cursor, 1);
    iterations += 1;
  }
  // Ensure the line starts at the full task count and clamp for readability.
  const first = points[0];
  if (first) {
    points[0] = { ...first, planned: totalTasks };
  }
  return points;
}

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}
