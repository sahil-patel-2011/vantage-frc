import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Robot Weigh-In (never DEMO scale readings). */
export const ROBOT_WEIGH_IN_RELATED_LINKS = [
  { id: "readiness-score", label: "Readiness", tab: "readiness-score" },
  { id: "inspection-copilot", label: "Inspection Copilot", tab: "inspection-copilot" },
  { id: "spare-robot-kit", label: "Spare Robot Kit", tab: "spare-robot-kit" },
  { id: "fmea", label: "FMEA", tab: "fmea" },
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

export function robotWeighInSetupSteps(orgId?: string | null): RobotWeighInSetupStepLink[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — weigh-ins are org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "readiness",
      label: "Open Readiness Score",
      detail: "Weight margin feeds competition readiness — never fabricated.",
      href: hubHref("/build", "readiness-score", orgId),
    },
    {
      id: "inspection",
      label: "Open Inspection Copilot",
      detail: "Event weigh-ins sit beside inspection readiness checks.",
      href: hubHref("/build", "inspection-copilot", orgId),
    },
  ];
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
        description: "Checking workspace membership and scale readings — never DEMO weigh-ins.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Robot Weigh-In",
        description:
          "A network or server issue blocked weigh-ins. Retry, or open Readiness while it reloads — never invent DEMO weights.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Robot Weigh-In is org-scoped. Pick a workspace before logging real scale readings — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No weigh-ins yet",
        title: "Log your first robot weigh-in",
        description:
          "Shop and event scale readings surface here — never DEMO weight packs.",
      };
    default:
      return {
        kind: "ready",
        title: "Robot weigh-in log",
        description: "Weights from your scale logs only — never DEMO counters.",
      };
  }
}

export function robotWeighInNextActions(input: {
  orgId?: string | null;
  shell: RobotWeighInShellKind;
  entryCount?: number;
  overLimitCount?: number;
}): RobotWeighInNextAction[] {
  const orgId = input.orgId ?? null;
  const entryCount = input.entryCount ?? 0;
  const overLimitCount = input.overLimitCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Weigh-ins are org-scoped — pick a team before logging scale readings.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "readiness",
          label: "Open Readiness Score",
          detail: "Readiness stays blank until real build signals exist.",
          href: hubHref("/build", "readiness-score", null),
        },
        {
          id: "inspection",
          label: "Open Inspection Copilot",
          detail: "Inspection checks stay empty until you configure them.",
          href: hubHref("/build", "inspection-copilot", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Finish membership setup so Robot Weigh-In can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "readiness",
        label: "Open Readiness Score",
        detail: "Weight margin feeds competition readiness.",
        href: hubHref("/build", "readiness-score", orgId),
      },
      {
        id: "inspection",
        label: "Open Inspection Copilot",
        detail: "Pair event weigh-ins with inspection readiness.",
        href: hubHref("/build", "inspection-copilot", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Robot Weigh-In",
        detail: "Reload real scale readings — nothing is invented while this fails.",
        href: withOrgHref("/robot-weigh-in", orgId),
        primary: true,
      },
      {
        id: "readiness",
        label: "Open Readiness Score",
        detail: "Readiness stays available while weigh-ins reload.",
        href: hubHref("/build", "readiness-score", orgId),
      },
      {
        id: "kit",
        label: "Open Spare Robot Kit",
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
        detail: "Scale readings stay blank until you record one — never DEMO weights.",
        href: "#robot-weigh-in-form",
        primary: true,
      },
      {
        id: "readiness",
        label: "Open Readiness Score",
        detail: "Readiness waits on real weight margin.",
        href: hubHref("/build", "readiness-score", orgId),
      },
      {
        id: "inspection",
        label: "Open Inspection Copilot",
        detail: "Prep inspection checks beside future event weigh-ins.",
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
          ? `${overLimitCount} reading${overLimitCount === 1 ? "" : "s"} over the limit from real scale logs — never DEMO weights.`
          : `${entryCount} weigh-in${entryCount === 1 ? "" : "s"} logged — never DEMO counters.`,
      href: "#robot-weigh-in-entries",
      primary: true,
    },
    {
      id: "readiness",
      label: "Open Readiness Score",
      detail: "Cross-check weight margin with competition readiness.",
      href: hubHref("/build", "readiness-score", orgId),
    },
    {
      id: "kit",
      label: "Open Spare Robot Kit",
      detail: "Pack mass-sensitive spares beside the weight log.",
      href: hubHref("/build", "spare-robot-kit", orgId),
    },
  ];
}
