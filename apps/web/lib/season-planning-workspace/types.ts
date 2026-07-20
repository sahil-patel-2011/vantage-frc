export type PlanStatus = "active" | "archived";
export type GoalCategory = "build" | "competition" | "outreach" | "business" | "ops" | "other";
export type WorkItemStatus = "planned" | "in_progress" | "done" | "dropped";

export type SeasonPlanSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type SeasonMember = {
  userId: string;
  name: string | null;
  email: string | null;
};

export type SeasonMilestone = {
  id: string;
  goalId: string;
  title: string;
  dueOn: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  status: WorkItemStatus;
  calendarEventUid: string | null;
  sortOrder: number;
};

export type SeasonGoal = {
  id: string;
  title: string;
  category: GoalCategory;
  ownerUserId: string | null;
  ownerName: string | null;
  targetDate: string | null;
  status: WorkItemStatus;
  sortOrder: number;
  milestones: SeasonMilestone[];
  milestoneDone: number;
  milestoneTotal: number;
};

export type SeasonPlanSummary = {
  id: string;
  title: string;
  status: PlanStatus;
  seasonYear: number;
  updatedAt: string;
};

export type SeasonSignalProgress = {
  attendanceEventCount: number;
  attendanceEntryCount: number;
  buildTaskTotal: number;
  buildTaskDone: number;
  /** Null when no build tasks exist — never invent a % from empty data. */
  buildCompletionPct: number | null;
};

export type SeasonPlanProgress = {
  goalsTotal: number;
  goalsDone: number;
  milestonesTotal: number;
  milestonesDone: number;
  /** Null when no milestones exist. */
  milestoneCompletionPct: number | null;
  signals: SeasonSignalProgress;
};
