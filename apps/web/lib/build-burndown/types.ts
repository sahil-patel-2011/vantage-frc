// Build-season burndown domain types. Pure data shapes — no I/O, no framework imports.
// Tracks build tasks (with a planned completion date from the kickoff plan) against actual
// completion, so a burndown chart can show remaining work vs. the ideal plan line.

export type BuildTaskCategory =
  | "mechanical"
  | "electrical"
  | "software"
  | "drivetrain"
  | "autonomous"
  | "other";

export type BuildTaskStatus = "pending" | "in_progress" | "done" | "blocked";

export type BuildBurndownTask = {
  id: string;
  title: string;
  category: BuildTaskCategory;
  status: BuildTaskStatus;
  /** ISO date (YYYY-MM-DD) — the kickoff-plan target completion date. */
  plannedDate: string;
  /** ISO date (YYYY-MM-DD) the task was actually marked done, or null. */
  completedOn: string | null;
  seasonYear: number;
  notes: string | null;
  createdAt: string;
};

export type BuildBurndownPlan = {
  id: string;
  seasonYear: number;
  /** ISO date (YYYY-MM-DD) — build season start. */
  kickoffDate: string;
  /** ISO date (YYYY-MM-DD) — first competition, the build-window end. */
  competitionDate: string;
};

/** One point on the burndown chart. */
export type BurndownPoint = {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Ideal remaining-task count if work finishes exactly on each task's planned date. */
  planned: number;
  /** Actual remaining-task count as of this date (only populated up to today). */
  actual: number | null;
};

export type BuildBurndownSummary = {
  totalTasks: number;
  completedTasks: number;
  remainingTasks: number;
  blockedTasks: number;
  overdueTasks: number;
  percentComplete: number;
  byCategory: Array<{ category: BuildTaskCategory; total: number; completed: number }>;
  /** 0..1: fraction ahead(+)/behind(-) of the ideal plan line as of today, clamped to [-1, 1]. */
  paceSignal: number;
};
