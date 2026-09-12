import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Burndown (never DEMO burndown metrics). */
export const BUILD_BURNDOWN_RELATED_LINKS = [
  { id: "task-board", label: "Task board", kind: "team" as const, tab: "task-board" },
  { id: "kickoff", label: "Kickoff", kind: "build" as const, tab: "kickoff" },
  { id: "fmea", label: "Failure log", kind: "build" as const, tab: "fmea" },
  { id: "team", label: "Team hub", kind: "team" as const, tab: "build-burndown" },
] as const;

export type BuildBurndownRelatedId = (typeof BUILD_BURNDOWN_RELATED_LINKS)[number]["id"];

export type BuildBurndownRelatedLink = {
  id: BuildBurndownRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Task board · Kickoff · FMEA. */
export const BUILD_BURNDOWN_RELATED_INCLUDE: BuildBurndownRelatedId[] = [
  "task-board",
  "kickoff",
  "fmea",
];

/**
 * Soft-UI cross-links from Burndown → Task board / Kickoff / Failure log.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function buildBurndownRelatedLinks(
  orgId?: string | null,
  options?: { active?: BuildBurndownRelatedId; include?: BuildBurndownRelatedId[] },
): BuildBurndownRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return BUILD_BURNDOWN_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "team") {
      return { id: link.id, label: link.label, href: hubHref("/team", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: hubHref("/build", link.tab, orgId) };
  });
}

export type BuildBurndownShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type BuildBurndownNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type BuildBurndownEmptyCopy = {
  kind: BuildBurndownShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO burndown metrics. */
export type BuildBurndownSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function buildBurndownSetupSteps(orgId?: string | null): BuildBurndownSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open burndown plans.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "kickoff",
      label: "Open Kickoff",
      detail: "Set the real build-season window from kickoff materials.",
      href: hubHref("/build", "kickoff", orgId),
    },
    {
      id: "task-board",
      label: "Open Task board",
      detail: "Day-to-day build tasks stay blank until real work is logged.",
      href: hubHref("/team", "task-board", orgId),
    },
    {
      id: "fmea",
      label: "Open Failure log",
      detail: "Risk work sits beside the burndown.",
      href: hubHref("/build", "fmea", orgId),
    },
  ];
}

/** Real task counts only — never invent DEMO totals. */
export function formatBuildBurndownMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Real percent complete only — never invent DEMO progress. */
export function formatBuildBurndownPercent(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0%";
  return `${Math.round(Math.min(1, n) * 100)}%`;
}

/** Hide zeroed summary tiles when no tasks exist — avoids DEMO counters. */
export function shouldShowBuildBurndownSummaryTiles(input: {
  taskCount: number;
  hasPlan: boolean;
}): boolean {
  return input.taskCount > 0 || input.hasPlan;
}

/** True when the team has no build tasks yet — Soft-UI empty. */
export function isBuildBurndownBoardEmpty(input: { taskCount: number }): boolean {
  return input.taskCount === 0;
}

/** Classify Burndown Soft-UI shell — never invents DEMO burndown metrics. */
export function classifyBuildBurndownShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  taskCount?: number;
}): BuildBurndownShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if (isBuildBurndownBoardEmpty({ taskCount: input.taskCount ?? 0 })) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO burndown metrics. */
export function buildBurndownShellCopy(kind: BuildBurndownShellKind): BuildBurndownEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Opening Burndown",
        description:
          "Checking which team you are on and real build tasks.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Burndown",
        description:
          "A network or server issue blocked burndown. Retry, or open Task board / Kickoff / Failure log while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before charting remaining work.",
      };
    case "empty":
      return {
        kind,
        badge: "No tasks yet",
        title: "Add your first build task",
        description:
          "The burndown line stays blank until you log real tasks with planned dates. Cross-check Task board, Kickoff, and Failure log.",
      };
    default:
      return {
        kind: "ready",
        title: "Burndown",
        description:
          "Tasks with planned dates are what draw the chart.",
      };
  }
}

/**
 * Soft-UI next actions for Burndown empty/setup shells.
 * Points at Task board / Kickoff / Failure log — never invents DEMO burndown metrics.
 */
export function buildBurndownNextActions(input: {
  orgId?: string | null;
  shell: BuildBurndownShellKind;
  taskCount?: number;
  hasPlan?: boolean;
  remainingTasks?: number;
}): BuildBurndownNextAction[] {
  const orgId = input.orgId ?? null;
  const taskCount = input.taskCount ?? 0;
  const hasPlan = input.hasPlan ?? false;
  const remainingTasks = input.remainingTasks ?? 0;

  if (!orgId || input.shell === "setup") {
    // One list, not two: the setup shell offers exactly the setup steps. These
    // used to be a second hand-written copy of buildBurndownSetupSteps with the same ids and
    // different wording, so the screen showed the same guided list twice.
    return setupActionsFrom(buildBurndownSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Burndown",
        detail: "Reload real tasks and plans.",
        href: withOrgHref("/build-burndown", orgId),
        primary: true,
      },
      {
        id: "task-board",
        label: "Open Task board",
        detail: "Task ownership stays available while Burndown reloads.",
        href: hubHref("/team", "task-board", orgId),
      },
      {
        id: "kickoff",
        label: "Open Kickoff",
        detail: "Season window stays independent of this chart.",
        href: hubHref("/build", "kickoff", orgId),
      },
      {
        id: "fmea",
        label: "Open Failure log",
        detail: "Failure modes stay honest when this surface is down.",
        href: hubHref("/build", "fmea", orgId),
      },
    ];
  }

  if (input.shell === "empty" || taskCount === 0) {
    return [
      {
        id: "task",
        label: hasPlan ? "Add a build task" : "Set the kickoff plan",
        detail: hasPlan
          ? "Log a task with a planned date below to start the chart."
          : "Enter kickoff and competition dates first so the ideal line uses real season windows.",
        href: hasPlan ? "#build-burndown-tasks" : "#build-burndown-plan",
        primary: true,
      },
      {
        id: "kickoff",
        label: "Open Kickoff",
        detail: "Confirm season timing from real kickoff materials.",
        href: hubHref("/build", "kickoff", orgId),
      },
      {
        id: "task-board",
        label: "Open Task board",
        detail: "Mirror ownership of build work on the season task board.",
        href: hubHref("/team", "task-board", orgId),
      },
      {
        id: "fmea",
        label: "Open Failure log",
        detail: "Track failure risks beside remaining build work.",
        href: hubHref("/build", "fmea", orgId),
      },
    ];
  }

  return [
    {
      id: "remaining",
      label: remainingTasks > 0 ? "Review remaining tasks" : "Burndown ready",
      detail:
        remainingTasks > 0
          ? `${remainingTasks} task${remainingTasks === 1 ? "" : "s"} remaining — from logged rows only.`
          : "Progress and pace use real task status only.",
      href: "#build-burndown-tasks",
      primary: true,
    },
    {
      id: "task-board",
      label: "Open Task board",
      detail: "Day-to-day assignment lives beside this season chart.",
      href: hubHref("/team", "task-board", orgId),
    },
    {
      id: "kickoff",
      label: "Open Kickoff",
      detail: "Re-check competition timing if the plan line looks off.",
      href: hubHref("/build", "kickoff", orgId),
    },
    {
      id: "fmea",
      label: "Open Failure log",
      detail: "Cross-check failure risks against remaining build work.",
      href: hubHref("/build", "fmea", orgId),
    },
  ];
}
