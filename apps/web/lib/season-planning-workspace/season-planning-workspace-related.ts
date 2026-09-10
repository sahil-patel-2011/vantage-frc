import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Season Planning Workspace (never DEMO completion %). */
export const SEASON_PLANNING_RELATED_LINKS = [
  { id: "goals-tracker", label: "Season Goals", tab: "goals-tracker" },
  { id: "calendar", label: "Calendar", tab: "calendar" },
  { id: "attendance", label: "Attendance", tab: "attendance" },
  { id: "build-burndown", label: "Build Burndown", tab: "build-burndown" },
  { id: "task-board", label: "Task Board", tab: "task-board" },
] as const;

export type SeasonPlanningRelatedId = (typeof SEASON_PLANNING_RELATED_LINKS)[number]["id"];

export type SeasonPlanningRelatedLink = {
  id: SeasonPlanningRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Goals / Calendar / Attendance. */
export const SEASON_PLANNING_RELATED_INCLUDE: SeasonPlanningRelatedId[] = [
  "goals-tracker",
  "calendar",
  "attendance",
];

/**
 * Soft-UI cross-links from Season Planning → Goals / Calendar / Attendance.
 * Build with hubHref — never broken JSX href templates.
 */
export function seasonPlanningRelatedLinks(
  orgId?: string | null,
  options?: { active?: SeasonPlanningRelatedId; include?: SeasonPlanningRelatedId[] },
): SeasonPlanningRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return SEASON_PLANNING_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/team", link.tab, orgId),
  }));
}

export type SeasonPlanningShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type SeasonPlanningNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type SeasonPlanningEmptyCopy = {
  kind: SeasonPlanningShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type SeasonPlanningSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function seasonPlanningSetupSteps(orgId?: string | null): SeasonPlanningSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open season plans.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "goals-tracker",
      label: "Open Season Goals",
      detail: "Lightweight goal tracking pairs with this team.",
      href: hubHref("/team", "goals-tracker", orgId),
    },
    {
      id: "calendar",
      label: "Open Calendar",
      detail: "Milestone .ics hooks land on your team calendar once dated.",
      href: hubHref("/team", "calendar", orgId),
    },
    {
      id: "attendance",
      label: "Open Attendance",
      detail: "Progress signals use real check-ins only.",
      href: hubHref("/team", "attendance", orgId),
    },
  ];
}

/** Real goal / milestone counts only — never invent DEMO totals. */
export function formatSeasonPlanningMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when no goals exist — avoids DEMO counters. */
export function shouldShowSeasonPlanningSummaryTiles(input: {
  goalsTotal: number;
  milestonesTotal: number;
}): boolean {
  return input.goalsTotal > 0 || input.milestonesTotal > 0;
}

/** Classify Season Planning Soft-UI shell — never invents DEMO completion %. */
export function classifySeasonPlanningShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "empty" | "live" | null;
  orgId?: string | null;
}): SeasonPlanningShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if (input.status === "empty") return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO completion %. */
export function seasonPlanningShellCopy(kind: SeasonPlanningShellKind): SeasonPlanningEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Season Planning Workspace…",
        description:
          "Checking which team you are on and season plans.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Season Planning Workspace",
        description:
          "A network or server issue blocked the plan. Retry, or open Goals / Calendar while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team",
        description:
          "Select a team before creating a plan.",
      };
    case "empty":
      return {
        kind,
        badge: "No plan",
        title: "Create this season’s plan",
        description:
          "Add goals and dated milestones with owners. Attendance and build-task signals appear only when those modules have real rows.",
      };
    default:
      return {
        kind: "ready",
        title: "Season goals and milestones",
        description:
          "Progress uses real attendance and build-task data.",
      };
  }
}

/**
 * Soft-UI next actions for Season Planning empty/setup shells.
 * Points at Goals / Calendar / Attendance — never invents DEMO completion %.
 */
export function seasonPlanningNextActions(input: {
  orgId?: string | null;
  shell: SeasonPlanningShellKind;
  goalsTotal?: number;
  milestonesTotal?: number;
}): SeasonPlanningNextAction[] {
  const orgId = input.orgId ?? null;
  const goalsTotal = input.goalsTotal ?? 0;
  const milestonesTotal = input.milestonesTotal ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team before creating goals.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "goals-tracker",
          label: "Open Season Goals",
          detail: "Goal rows stay blank until your team enters them.",
          href: hubHref("/team", "goals-tracker", null),
        },
        {
          id: "calendar",
          label: "Open Calendar",
          detail: "Calendar stays empty until events exist.",
          href: hubHref("/team", "calendar", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Season Planning can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "goals-tracker",
        label: "Open Season Goals",
        detail: "Pair lightweight goals with this team plan.",
        href: hubHref("/team", "goals-tracker", orgId),
      },
      {
        id: "calendar",
        label: "Open Calendar",
        detail: "Confirm the season calendar before dating milestones.",
        href: hubHref("/team", "calendar", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Season Planning",
        detail: "Reload real plans.",
        href: withOrgHref("/season-planning-workspace", orgId),
        primary: true,
      },
      {
        id: "goals-tracker",
        label: "Open Season Goals",
        detail: "Goals stay available while the plan reloads.",
        href: hubHref("/team", "goals-tracker", orgId),
      },
      {
        id: "calendar",
        label: "Open Calendar",
        detail: "Calendar stays available while the plan reloads.",
        href: hubHref("/team", "calendar", orgId),
      },
    ];
  }

  if (input.shell === "empty") {
    return [
      {
        id: "create",
        label: "Create season plan",
        detail: "Start a plan for this season, then add goals and milestones.",
        href: "#season-plan-create",
        primary: true,
      },
      {
        id: "goals-tracker",
        label: "Open Season Goals",
        detail: "Track lighter goals alongside the team plan.",
        href: hubHref("/team", "goals-tracker", orgId),
      },
      {
        id: "attendance",
        label: "Open Attendance",
        detail: "Check-ins feed progress signals.",
        href: hubHref("/team", "attendance", orgId),
      },
    ];
  }

  if (goalsTotal === 0) {
    return [
      {
        id: "add-goal",
        label: "Add your first goal",
        detail: "Break the season into owned goals — progress % stays blank until milestones exist.",
        href: "#season-plan-add-goal",
        primary: true,
      },
      {
        id: "calendar",
        label: "Open Calendar",
        detail: "Date milestones once goals exist.",
        href: hubHref("/team", "calendar", orgId),
      },
      {
        id: "build-burndown",
        label: "Open Build Burndown",
        detail: "Pair plan milestones with real build-task burn.",
        href: hubHref("/team", "build-burndown", orgId),
      },
    ];
  }

  return [
    {
      id: "milestones",
      label: milestonesTotal > 0 ? "Update milestones" : "Add milestones",
      detail:
        milestonesTotal > 0
          ? `${milestonesTotal} milestone${milestonesTotal === 1 ? "" : "s"} on file — owners and due dates only.`
          : "Dated milestones unlock completion %.",
      href: "#season-plan-goals",
      primary: true,
    },
    {
      id: "attendance",
      label: "Open Attendance",
      detail: "Progress signals use real check-ins only.",
      href: hubHref("/team", "attendance", orgId),
    },
    {
      id: "build-burndown",
      label: "Open Build Burndown",
      detail: "Cross-check build-task completion against plan milestones.",
      href: hubHref("/team", "build-burndown", orgId),
    },
    {
      id: "ics",
      label: "Export milestones .ics",
      detail: "Calendar hooks for dated milestones only.",
      href: "#season-plan-ics",
    },
  ];
}
