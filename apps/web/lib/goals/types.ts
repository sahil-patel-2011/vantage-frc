// Season Goals & Objectives domain types. Pure data shapes — no I/O, no framework imports.
// A team sets measurable season objectives (competition, technical, outreach, business, team)
// and tracks progress toward each; the app derives per-goal status and a season scorecard.

export type GoalCategory = "competition" | "technical" | "outreach" | "business" | "team" | "other";

/** How a goal is measured. `binary` = yes/no; the rest are numeric target vs current. */
export type MetricType = "percent" | "count" | "currency" | "binary";

export type GoalPriority = "low" | "normal" | "high";

export type GoalStatus = "not_started" | "in_progress" | "at_risk" | "achieved" | "missed";

export type SeasonGoal = {
  id: string;
  title: string;
  category: GoalCategory;
  metricType: MetricType;
  targetValue: number;
  currentValue: number;
  /** Display unit for count goals (e.g. "matches", "hours"); null for the others. */
  unit: string | null;
  /** ISO date (YYYY-MM-DD) or null. */
  dueOn: string | null;
  priority: GoalPriority;
  notes: string | null;
  seasonYear: number;
};

export type GoalEvaluation = {
  goal: SeasonGoal;
  /** 0..1 fraction of the target reached. */
  progress: number;
  status: GoalStatus;
  daysToDue: number | null;
};

export type CategoryRollup = {
  category: GoalCategory;
  total: number;
  achieved: number;
  avgProgress: number;
};

export type GoalsSummary = {
  total: number;
  achieved: number;
  achievedPct: number;
  /** Simple mean of per-goal progress. */
  avgProgress: number;
  /** Progress weighted by goal priority (high=3, normal=2, low=1). */
  weightedProgress: number;
  statusCounts: Record<GoalStatus, number>;
  byCategory: CategoryRollup[];
  /** At-risk or missed goals, most urgent first. */
  needsAttention: GoalEvaluation[];
};
