// Build Task Board domain types. Pure data shapes — no I/O, no framework imports.
// A lightweight engineering task tracker for the build season: subsystem work items with
// status, priority, owner, and due dates, plus derived board/progress views.

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "archived";
export type TaskPriority = "low" | "normal" | "high" | "critical";

export type BuildTask = {
  id: string;
  title: string;
  /** Free-text subsystem tag (drivetrain, intake, electrical, software, …). */
  subsystem: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Free-text owner name (students may not be platform users). */
  assignee: string | null;
  estimateHours: number | null;
  /** ISO date (YYYY-MM-DD) or null. */
  dueOn: string | null;
  blockedReason: string | null;
  notes: string | null;
  /** ISO timestamp when the task was completed, or null. */
  doneAt: string | null;
  seasonYear: number;
  /** ISO timestamp. */
  createdAt: string;
};

export type TaskFlags = {
  overdue: boolean;
  dueSoon: boolean;
  /** Whole days since creation, relative to the evaluation date. */
  ageDays: number;
  daysToDue: number | null;
};

export type TaskWithFlags = BuildTask & { flags: TaskFlags };

export type BoardColumn = {
  status: TaskStatus;
  label: string;
  tasks: TaskWithFlags[];
  count: number;
};

export type SubsystemProgress = {
  subsystem: string;
  total: number;
  done: number;
  open: number;
  completionPct: number;
};

export type WeeklyThroughput = {
  /** ISO week start date (Monday, YYYY-MM-DD). */
  weekStart: string;
  completed: number;
};

export type TaskMetrics = {
  /** Counts exclude archived tasks. */
  total: number;
  open: number;
  done: number;
  blocked: number;
  inProgress: number;
  unassigned: number;
  overdue: number;
  dueSoon: number;
  completionPct: number;
  estimatedOpenHours: number;
  bySubsystem: SubsystemProgress[];
  byPriority: Array<{ priority: TaskPriority; open: number }>;
  throughput: WeeklyThroughput[];
};

export type TaskBoard = {
  columns: BoardColumn[];
  metrics: TaskMetrics;
  /** Prioritized, actionable "do next" list (excludes done/blocked/archived). */
  focus: TaskWithFlags[];
};
