// Pure board/metrics derivation for the Build Task Board. Deterministic given its input;
// "now" is always injected as `asOf` so callers (and tests) stay reproducible.

import type {
  BoardColumn,
  BuildTask,
  SubsystemProgress,
  TaskBoard,
  TaskMetrics,
  MemberWorkload,
  MeetingOutput,
  TaskPriority,
  TaskStatus,
  TaskWithFlags,
  WeeklyThroughput,
} from "./types";

const BOARD_ORDER: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];
const PRIORITY_ORDER: TaskPriority[] = ["critical", "high", "normal", "low"];

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

export function statusLabel(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    todo: "To do",
    in_progress: "In progress",
    blocked: "Blocked",
    done: "Done",
    archived: "Archived",
  };
  return labels[status];
}

export function priorityLabel(priority: TaskPriority): string {
  const labels: Record<TaskPriority, string> = {
    low: "Low",
    normal: "Normal",
    high: "High",
    critical: "Critical",
  };
  return labels[priority];
}

export function priorityWeight(priority: TaskPriority): number {
  return PRIORITY_WEIGHT[priority];
}

function dayDiff(fromIso: string, toIso: string): number | null {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

function withFlags(task: BuildTask, asOf: string): TaskWithFlags {
  const active = task.status !== "done" && task.status !== "archived";
  const daysToDue = task.dueOn ? dayDiff(asOf, task.dueOn) : null;
  const ageDays = Math.max(0, dayDiff(task.createdAt, asOf) ?? 0);
  return {
    ...task,
    flags: {
      overdue: active && daysToDue != null && daysToDue < 0,
      dueSoon: active && daysToDue != null && daysToDue >= 0 && daysToDue <= 3,
      daysToDue,
      ageDays,
    },
  };
}

/** Monday (UTC) of the ISO week containing `iso`, as YYYY-MM-DD. */
export function isoWeekStart(iso: string): string | null {
  const ms = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  const date = new Date(ms);
  const dow = date.getUTCDay(); // 0=Sun..6=Sat
  const backToMonday = (dow + 6) % 7;
  const monday = new Date(ms - backToMonday * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

function weeklyThroughput(tasks: BuildTask[], asOf: string, weeks: number): WeeklyThroughput[] {
  const thisWeek = isoWeekStart(asOf);
  if (!thisWeek) return [];
  const anchor = Date.parse(`${thisWeek}T00:00:00Z`);
  const buckets = new Map<string, number>();
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const weekStart = new Date(anchor - i * 7 * 86_400_000).toISOString().slice(0, 10);
    buckets.set(weekStart, 0);
  }
  for (const task of tasks) {
    if (task.status !== "done" || !task.doneAt) continue;
    const week = isoWeekStart(task.doneAt);
    if (week && buckets.has(week)) buckets.set(week, (buckets.get(week) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([weekStart, completed]) => ({ weekStart, completed }));
}

function summarize(flagged: TaskWithFlags[], asOf: string, weeks: number): TaskMetrics {
  const live = flagged.filter((task) => task.status !== "archived");
  const done = live.filter((task) => task.status === "done");
  const open = live.filter((task) => task.status !== "done");
  const blocked = live.filter((task) => task.status === "blocked");
  const inProgress = live.filter((task) => task.status === "in_progress");

  const subsystemMap = new Map<string, { total: number; done: number }>();
  for (const task of live) {
    const key = task.subsystem || "general";
    const entry = subsystemMap.get(key) ?? { total: 0, done: 0 };
    entry.total += 1;
    if (task.status === "done") entry.done += 1;
    subsystemMap.set(key, entry);
  }
  const bySubsystem: SubsystemProgress[] = [...subsystemMap.entries()]
    .map(([subsystem, value]) => ({
      subsystem,
      total: value.total,
      done: value.done,
      open: value.total - value.done,
      completionPct: value.total > 0 ? Math.round((value.done / value.total) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.open - a.open || b.total - a.total || a.subsystem.localeCompare(b.subsystem));

  const byPriority = PRIORITY_ORDER.map((priority) => ({
    priority,
    open: open.filter((task) => task.priority === priority).length,
  })).filter((row) => row.open > 0);

  const estimatedOpenHours =
    Math.round(open.reduce((sum, task) => sum + (task.estimateHours ?? 0), 0) * 10) / 10;

  return {
    total: live.length,
    open: open.length,
    done: done.length,
    blocked: blocked.length,
    inProgress: inProgress.length,
    unassigned: open.filter((task) => !(task.assignees?.length || task.assignee)).length,
    overdue: live.filter((task) => task.flags.overdue).length,
    dueSoon: live.filter((task) => task.flags.dueSoon).length,
    completionPct: live.length > 0 ? Math.round((done.length / live.length) * 100) / 100 : 0,
    estimatedOpenHours,
    bySubsystem,
    byPriority,
    throughput: weeklyThroughput(flagged, asOf, weeks),
  };
}

/**
 * Prioritized "do next" list: open, unblocked tasks ranked by priority, then due proximity
 * (soonest first, undated last), then age (oldest first). Blocked/done/archived excluded.
 */
export function focusList(tasks: BuildTask[], asOf: string = todayIso(), limit = 6): TaskWithFlags[] {
  return tasks
    .map((task) => withFlags(task, asOf))
    .filter((task) => task.status === "todo" || task.status === "in_progress")
    .sort((a, b) => {
      const byPriority = priorityWeight(b.priority) - priorityWeight(a.priority);
      if (byPriority !== 0) return byPriority;
      const aDue = a.flags.daysToDue;
      const bDue = b.flags.daysToDue;
      if (aDue != null && bDue != null && aDue !== bDue) return aDue - bDue;
      if (aDue != null && bDue == null) return -1;
      if (aDue == null && bDue != null) return 1;
      return b.flags.ageDays - a.flags.ageDays;
    })
    .slice(0, Math.max(0, limit));
}

export function buildBoard(
  tasks: BuildTask[],
  asOf: string = todayIso(),
  options: { throughputWeeks?: number; focusLimit?: number } = {},
): TaskBoard {
  const throughputWeeks = options.throughputWeeks ?? 6;
  const flagged = tasks.map((task) => withFlags(task, asOf));

  const columns: BoardColumn[] = BOARD_ORDER.map((status) => {
    const columnTasks = flagged
      .filter((task) => task.status === status)
      .sort((a, b) => {
        const byPriority = priorityWeight(b.priority) - priorityWeight(a.priority);
        if (byPriority !== 0) return byPriority;
        const aDue = a.flags.daysToDue;
        const bDue = b.flags.daysToDue;
        if (aDue != null && bDue != null && aDue !== bDue) return aDue - bDue;
        if (aDue != null && bDue == null) return -1;
        if (aDue == null && bDue != null) return 1;
        return a.title.localeCompare(b.title);
      });
    return { status, label: statusLabel(status), tasks: columnTasks, count: columnTasks.length };
  });

  return {
    columns,
    metrics: summarize(flagged, asOf, throughputWeeks),
    focus: focusList(tasks, asOf, options.focusLimit ?? 6),
  };
}

/** UTC "today" as YYYY-MM-DD. Isolated so tests inject a fixed date instead. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function buildMemberWorkload(
  members: Array<{ userId: string; name: string }>,
  tasks: BuildTask[],
): MemberWorkload[] {
  return members.map((member) => {
    const key = member.name.trim().toLocaleLowerCase();
    const assigned = tasks.filter((task) => {
      if (task.status === "done" || task.status === "archived") return false;
      const names = task.assignees?.length ? task.assignees : task.assignee ? [task.assignee] : [];
      return names.some((name) => name.trim().toLocaleLowerCase() === key);
    });
    return {
      userId: member.userId,
      name: member.name,
      openTasks: assigned.length,
      inProgressTasks: assigned.filter((task) => task.status === "in_progress").length,
      estimatedOpenHours: Math.round(assigned.reduce((sum, task) => sum + (task.estimateHours ?? 0), 0) * 10) / 10,
      availableNow: assigned.length === 0,
    };
  });
}

export function summarizeMeetingOutput(input: {
  weekStart: string;
  loggedHours: number;
  tasksCompleted: number;
}): MeetingOutput {
  const loggedHours = Math.max(0, Math.round(input.loggedHours * 10) / 10);
  const tasksCompleted = Math.max(0, Math.trunc(input.tasksCompleted));
  return {
    weekStart: input.weekStart,
    loggedHours,
    tasksCompleted,
    hoursPerCompletedTask: tasksCompleted ? Math.round((loggedHours / tasksCompleted) * 10) / 10 : null,
  };
}

export function visibleBenchmarkMedian(input: { optedIn: boolean; teamCount: number; median: number | null }) {
  return input.optedIn && input.teamCount >= 5 && input.median != null ? Math.round(input.median * 10) / 10 : null;
}
