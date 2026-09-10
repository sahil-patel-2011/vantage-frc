import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import type { TeamHubRelatedId } from "../team/team-related";
import type { GoalStatus } from "./types";

/** Focused Soft-UI Team strip when Goals is open (never DEMO placeholders). */
export const GOALS_TEAM_RELATED_INCLUDE: TeamHubRelatedId[] = [
  "todos",
  "practice",
  "calendar",
  "messages",
];

/**
 * Soft-UI related surfaces for season goals.
 * Breaks measurable season objectives into Todos / Practice work on Team hub.
 */
export const GOALS_RELATED_LINKS = [
  { id: "todos", label: "Todos", kind: "path" as const, path: "/todos" },
  { id: "practice", label: "Practice", kind: "path" as const, path: "/practice" },
  { id: "team", label: "Team hub", kind: "path" as const, path: "/team" },
  { id: "calendar", label: "Calendar", kind: "team" as const, tab: "calendar" },
  { id: "attendance", label: "Attendance", kind: "team" as const, tab: "attendance" },
] as const;

export type GoalsRelatedId = (typeof GOALS_RELATED_LINKS)[number]["id"];

export type GoalsRelatedLink = {
  id: GoalsRelatedId;
  label: string;
  href: string;
};

/** Cross-links for Goals Soft-UI (never DEMO progress %). */
export function goalsRelatedLinks(
  orgId?: string | null,
  options?: { active?: GoalsRelatedId; include?: GoalsRelatedId[] },
): GoalsRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return GOALS_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "team") {
      return { id: link.id, label: link.label, href: hubHref("/team", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type GoalsNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/**
 * Soft-UI next actions for season goals.
 * Points at real objectives / Todos / Practice — never DEMO progress.
 */
export function goalsNextActions(input: {
  orgId?: string | null;
  goalCount: number;
  achieved: number;
  needsAttention: number;
  topTitle?: string | null;
}): GoalsNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team before setting season goals.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const goalsHref = withOrgHref("/goals", orgId);
  const actions: GoalsNextAction[] = [];

  if (input.goalCount === 0) {
    actions.push({
      id: "add-first",
      label: "Add the first season goal",
      detail: "Progress stays blank until someone enters a real current value against a target — nothing is pre-filled.",
      href: goalsHref,
      primary: true,
    });
    actions.push({
      id: "todos",
      label: "Break work into Todos",
      detail: "Turn each objective into assignable tasks once the measurable target exists.",
      href: withOrgHref("/todos", orgId),
    });
    actions.push({
      id: "practice",
      label: "Log Practice sessions",
      detail: "Drive and field goals often update from real session reps.",
      href: withOrgHref("/practice", orgId),
    });
    actions.push({
      id: "team",
      label: "Open Team hub",
      detail: "Calendar, attendance, and messages sit next to the work that moves season goals.",
      href: withOrgHref("/team", orgId),
    });
    return actions;
  }

  if (input.needsAttention > 0) {
    const sample = input.topTitle?.trim() || "highest-priority goal";
    actions.push({
      id: "attention",
      label: `Address at-risk goals (${input.needsAttention})`,
      detail: `${sample} needs attention — status comes from real progress and due dates only.`,
      href: goalsHref,
      primary: true,
    });
  } else if (input.achieved < input.goalCount) {
    actions.push({
      id: "update",
      label: input.topTitle ? `Update “${input.topTitle}”` : "Update goal progress",
      detail: `${input.achieved}/${input.goalCount} achieved · enter current values from real work.`,
      href: goalsHref,
      primary: true,
    });
  }

  actions.push({
    id: "todos",
    label: "Assign follow-up Todos",
    detail: "Owners and due dates live on Todos — link the next concrete step from each goal.",
    href: withOrgHref("/todos", orgId),
    primary: actions.length === 0,
  });

  actions.push({
    id: "practice",
    label: "Tie Practice to competition goals",
    detail: "Log reps first; bump goal current values only when evidence exists.",
    href: withOrgHref("/practice", orgId),
  });

  if (actions.length < 5) {
    actions.push({
      id: "team",
      label: "Coordinate on Team hub",
      detail: "Calendar blocks and messages keep the whole org aligned on season objectives.",
      href: withOrgHref("/team", orgId),
    });
  }

  return actions.slice(0, 5);
}

/** Priority-weighted season progress — blank until at least one goal exists. */
export function formatGoalsProgressDisplay(weightedProgress: number, goalCount: number): string {
  if (goalCount <= 0) return "—";
  return `${Math.round(weightedProgress * 100)}%`;
}

/** Achieved fraction — blank until goals exist (never a DEMO 0/0). */
export function formatGoalsAchievedDisplay(achieved: number, total: number): string {
  if (total <= 0) return "—";
  return `${achieved}/${total}`;
}

export function goalStatusTone(status: GoalStatus): GoalStatus {
  return status;
}
