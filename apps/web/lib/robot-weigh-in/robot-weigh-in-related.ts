import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Robot Weigh-In (never DEMO scale readings). */
export const ROBOT_WEIGH_IN_RELATED_LINKS = [
  { id: "readiness-score", label: "Readiness", tab: "readiness-score" },
  { id: "inspection-copilot", label: "Inspection", tab: "inspection-copilot" },
  { id: "spare-robot-kit", label: "Spare Robot Kit", tab: "spare-robot-kit" },
  { id: "fmea", label: "Failure log", tab: "fmea" },
] as const;

export type RobotWeighInRelatedId = (typeof ROBOT_WEIGH_IN_RELATED_LINKS)[number]["id"];

export type RobotWeighInRelatedLink = {
  id: RobotWeighInRelatedId;
  label: string;
  href: string;
};

export const ROBOT_WEIGH_IN_RELATED_INCLUDE: RobotWeighInRelatedId[] = [
  "readiness-score",
  "inspection-copilot",
  "spare-robot-kit",
];

export function robotWeighInRelatedLinks(
  orgId?: string | null,
  options?: { active?: RobotWeighInRelatedId; include?: RobotWeighInRelatedId[] },
): RobotWeighInRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return ROBOT_WEIGH_IN_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/build", link.tab, orgId),
  }));
}

export type RobotWeighInShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type RobotWeighInNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type RobotWeighInEmptyCopy = {
  kind: RobotWeighInShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type RobotWeighInSetupStepLink = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

function robotWeighInRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    robotWeighInRelatedLinks(orgId, {
      include: [...ROBOT_WEIGH_IN_RELATED_INCLUDE],
    }).map((link) => link.href),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = robotWeighInRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

export function robotWeighInSetupSteps(orgId?: string | null): RobotWeighInSetupStepLink[] {
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team to open weigh-ins.",
        href: "/workspace",
      },
    ];
  }
  return dropRelatedStripDuplicates(orgId, [
    {
      id: "command",
      label: "Set active event",
      detail: "Pick the event this alliance is at — event weigh-ins stay empty until it is set.",
      href: hubHref("/competition", "command", orgId),
    },
  ]);
}

export function formatRobotWeighInMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

export function shouldShowRobotWeighInSummaryTiles(entryCount: number): boolean {
  return entryCount > 0;
}

export function classifyRobotWeighInShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  entryCount?: number;
}): RobotWeighInShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.entryCount ?? 0) === 0) return "empty";
  return "ready";
}

export function robotWeighInShellCopy(kind: RobotWeighInShellKind): RobotWeighInEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Robot Weigh-In…",
        description: "Checking which team you are on and scale readings.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Robot Weigh-In",
        description:
          "A network or server issue blocked weigh-ins. Retry, or open Readiness while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before logging real scale readings.",
      };
    case "empty":
      return {
        kind,
        badge: "No weigh-ins yet",
        title: "Log your first robot weigh-in",
        description:
          "Shop and event scale readings surface here.",
      };
    default:
      return {
        kind: "ready",
        title: "Robot weigh-in log",
        description: "Weights from your scale logs only.",
      };
  }
}

export function robotWeighInNextActions(input: {
  orgId?: string | null;
  shell: RobotWeighInShellKind;
  entryCount?: number;
  overLimitCount?: number;
  playoffReweighCue?: string | null;
}): RobotWeighInNextAction[] {
  const orgId = input.orgId ?? null;
  const entryCount = input.entryCount ?? 0;
  const overLimitCount = input.overLimitCount ?? 0;
  const playoffReweighCue = input.playoffReweighCue?.trim() || null;

  if (!orgId || input.shell === "setup") {
    // One list, not two: the setup shell offers exactly the setup steps. These
    // used to be a second hand-written copy of robotWeighInSetupSteps with the same ids and
    // different wording, so the screen showed the same guided list twice.
    return setupActionsFrom(robotWeighInSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Robot Weigh-In",
        detail: "Reload real scale readings.",
        href: withOrgHref("/robot-weigh-in", orgId),
        primary: true,
      },
      {
        id: "readiness",
        label: "Open Readiness",
        detail: "Readiness stays available while weigh-ins reload.",
        href: hubHref("/build", "readiness-score", orgId),
      },
      {
        id: "kit",
        label: "Open Spare kit",
        detail: "Pack lists stay available while weigh-ins reload.",
        href: hubHref("/build", "spare-robot-kit", orgId),
      },
    ];
  }

  if (input.shell === "empty" || entryCount === 0) {
    return [
      {
        id: "log-weigh-in",
        label: "Log a weigh-in",
        detail: "Scale readings stay blank until you record one.",
        href: "#robot-weigh-in-form",
        primary: true,
      },
      {
        id: "readiness",
        label: "Open Readiness",
        detail: "Readiness waits on real weight margin.",
        href: hubHref("/build", "readiness-score", orgId),
      },
      {
        id: "inspection",
        label: "Open Inspection",
        detail: "Prep inspection checks beside future event weigh-ins.",
        href: hubHref("/build", "inspection-copilot", orgId),
      },
    ];
  }

  if (playoffReweighCue) {
    return [
      {
        id: "playoff-reweigh",
        label: "Log playoff re-weigh",
        detail: playoffReweighCue,
        href: "#robot-weigh-in-form",
        primary: true,
      },
      {
        id: overLimitCount > 0 ? "over-limit" : "review-trend",
        label: overLimitCount > 0 ? "Review over-limit readings" : "Review weight trend",
        detail:
          overLimitCount > 0
            ? `${overLimitCount} reading${overLimitCount === 1 ? "" : "s"} over the limit from real scale logs.`
            : `${entryCount} weigh-in${entryCount === 1 ? "" : "s"} logged.`,
        href: "#robot-weigh-in-entries",
      },
      {
        id: "inspection",
        label: "Open Inspection",
        detail: "Pair the playoff re-weigh with inspection readiness.",
        href: hubHref("/build", "inspection-copilot", orgId),
      },
    ];
  }

  return [
    {
      id: overLimitCount > 0 ? "over-limit" : "review-trend",
      label: overLimitCount > 0 ? "Review over-limit readings" : "Review weight trend",
      detail:
        overLimitCount > 0
          ? `${overLimitCount} reading${overLimitCount === 1 ? "" : "s"} over the limit from real scale logs.`
          : `${entryCount} weigh-in${entryCount === 1 ? "" : "s"} logged.`,
      href: "#robot-weigh-in-entries",
      primary: true,
    },
    {
      id: "readiness",
      label: "Open Readiness",
      detail: "Cross-check weight margin with competition readiness.",
      href: hubHref("/build", "readiness-score", orgId),
    },
    {
      id: "kit",
      label: "Open Spare kit",
      detail: "Pack mass-sensitive spares beside the weight log.",
      href: hubHref("/build", "spare-robot-kit", orgId),
    },
  ];
}
