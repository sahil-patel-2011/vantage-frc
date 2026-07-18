// Season Goals/OKR tracker domain types. Pure data shapes — no I/O, no framework imports.
// Progress is always derived from real check-ins a member logged against a goal, never a
// fabricated/derived number.

export type GoalCategory = "build" | "competition" | "business" | "team" | "outreach" | "other";

export type GoalStatus = "active" | "completed" | "abandoned";

export type Goal = {
  id: string;
  title: string;
  description: string | null;
  category: GoalCategory;
  metricUnit: string;
  startValue: number;
  targetValue: number;
  status: GoalStatus;
  dueOn: string | null;
  seasonYear: number;
  createdAt: string;
};

export type GoalCheckin = {
  id: string;
  goalId: string;
  value: number;
  note: string | null;
  occurredOn: string;
  createdAt: string;
};

export type GoalProgress = {
  goal: Goal;
  latestValue: number | null;
  progress: number; // 0..1, clamped
  checkinCount: number;
  lastCheckinOn: string | null;
  onTrack: boolean | null; // null when there's no due date or no check-ins yet
  overdue: boolean;
  checkins: GoalCheckin[];
};

export type GoalsSummary = {
  totalGoals: number;
  activeGoals: number;
  completedGoals: number;
  abandonedGoals: number;
  overdueGoals: number;
  averageProgress: number; // 0..1, across active + completed goals
  byCategory: Array<{ category: GoalCategory; count: number; averageProgress: number }>;
};
