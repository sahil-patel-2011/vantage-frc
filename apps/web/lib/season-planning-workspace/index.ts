import type { GoalCategory, SeasonPlanProgress, SeasonSignalProgress, WorkItemStatus } from "./types";

export type {
  GoalCategory,
  PlanStatus,
  SeasonGoal,
  SeasonMember,
  SeasonMilestone,
  SeasonPlanProgress,
  SeasonPlanSetupStep,
  SeasonPlanSummary,
  SeasonSignalProgress,
  WorkItemStatus,
} from "./types";

export {
  buildSeasonPlanningIcs,
  computeSeasonPlanningWorkspaceView,
  createSeasonGoal,
  createSeasonMilestone,
  createSeasonPlan,
  updateSeasonGoalStatus,
  updateSeasonMilestoneStatus,
  type SeasonPlanningWorkspaceView,
} from "./compute-season-planning-workspace";

export const GOAL_CATEGORIES: GoalCategory[] = [
  "build",
  "competition",
  "outreach",
  "business",
  "ops",
  "other",
];

export const WORK_ITEM_STATUSES: WorkItemStatus[] = ["planned", "in_progress", "done", "dropped"];

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

export function goalCategoryLabel(category: GoalCategory): string {
  const labels: Record<GoalCategory, string> = {
    build: "Build",
    competition: "Competition",
    outreach: "Outreach",
    business: "Business",
    ops: "Ops",
    other: "Other",
  };
  return labels[category];
}

export function workItemStatusLabel(status: WorkItemStatus): string {
  if (status === "in_progress") return "In progress";
  if (status === "done") return "Done";
  if (status === "dropped") return "Dropped";
  return "Planned";
}

/** Pure progress rollup — never invents % when denominators are zero. */
export function computeSeasonPlanProgress(input: {
  goalsDone: number;
  goalsTotal: number;
  milestonesDone: number;
  milestonesTotal: number;
  signals: SeasonSignalProgress;
}): SeasonPlanProgress {
  const milestoneCompletionPct =
    input.milestonesTotal > 0
      ? Math.round((100 * input.milestonesDone) / input.milestonesTotal)
      : null;
  return {
    goalsTotal: input.goalsTotal,
    goalsDone: input.goalsDone,
    milestonesTotal: input.milestonesTotal,
    milestonesDone: input.milestonesDone,
    milestoneCompletionPct,
    signals: input.signals,
  };
}

export function computeBuildCompletionPct(done: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((100 * done) / total);
}
