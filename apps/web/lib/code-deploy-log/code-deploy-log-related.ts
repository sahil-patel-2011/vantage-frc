import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Code Deploy Log (never DEMO firmware trails). */
export const CODE_DEPLOY_LOG_RELATED_LINKS = [
  { id: "code", label: "Code Coach", tab: "code" },
  { id: "code-perf", label: "Code-vs-Match", tab: "code-perf" },
  { id: "cad", label: "CAD", tab: "cad" },
  { id: "readiness-score", label: "Readiness Score", tab: "readiness-score" },
] as const;

export type CodeDeployLogRelatedId = (typeof CODE_DEPLOY_LOG_RELATED_LINKS)[number]["id"];

export type CodeDeployLogRelatedLink = {
  id: CodeDeployLogRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Code / Code-vs-Match / CAD. */
export const CODE_DEPLOY_LOG_RELATED_INCLUDE: CodeDeployLogRelatedId[] = [
  "code",
  "code-perf",
  "cad",
];

/**
 * Soft-UI cross-links from Code Deploy Log → Code / Perf / CAD.
 * Build with hubHref — never broken JSX href templates.
 */
export function codeDeployLogRelatedLinks(
  orgId?: string | null,
  options?: { active?: CodeDeployLogRelatedId; include?: CodeDeployLogRelatedId[] },
): CodeDeployLogRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return CODE_DEPLOY_LOG_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/build", link.tab, orgId),
  }));
}

export type CodeDeployLogShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type CodeDeployLogNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type CodeDeployLogEmptyCopy = {
  kind: CodeDeployLogShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type CodeDeployLogSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function codeDeployLogSetupSteps(orgId?: string | null): CodeDeployLogSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open deploy logs.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "code",
      label: "Open Code Coach",
      detail: "Review firmware patterns before logging a deploy.",
      href: hubHref("/build", "code", orgId),
    },
    {
      id: "code-perf",
      label: "Open Code-vs-Match",
      detail: "Match-linked deploys pair with performance detective later.",
      href: hubHref("/build", "code-perf", orgId),
    },
    {
      id: "cad",
      label: "Open CAD",
      detail: "Mechanical releases stay separate from firmware deploys.",
      href: hubHref("/build", "cad", orgId),
    },
  ];
}

/** Real deploy counts only — never invent DEMO totals. */
export function formatCodeDeployLogMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when no deploys exist — avoids DEMO counters. */
export function shouldShowCodeDeployLogSummaryTiles(deployCount: number): boolean {
  return deployCount > 0;
}

/** Classify Code Deploy Log Soft-UI shell — never invents DEMO firmware trails. */
export function classifyCodeDeployLogShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  deployCount?: number;
}): CodeDeployLogShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.deployCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO firmware trails. */
export function codeDeployLogShellCopy(kind: CodeDeployLogShellKind): CodeDeployLogEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Code Deploy Log…",
        description: "Checking which team you are on and deploy history.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Code Deploy Log",
        description:
          "A network or server issue blocked the deploy trail. Retry, or open Code Coach while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Choose your team",
        description:
          "Choose your team before recording firmware builds.",
      };
    case "empty":
      return {
        kind,
        badge: "No deploys yet",
        title: "Log your first code deploy",
        description:
          "Record firmware version, commit, and match so you can trace robot behavior.",
      };
    default:
      return {
        kind: "ready",
        title: "Firmware evidence trail",
        description:
          "Deploys from your team only.",
      };
  }
}

/**
 * Soft-UI next actions for Code Deploy Log empty/setup shells.
 * Points at Code / Perf / CAD — never invents DEMO firmware trails.
 */
export function codeDeployLogNextActions(input: {
  orgId?: string | null;
  shell: CodeDeployLogShellKind;
  deployCount?: number;
  matchLinkedCount?: number;
}): CodeDeployLogNextAction[] {
  const orgId = input.orgId ?? null;
  const deployCount = input.deployCount ?? 0;
  const matchLinkedCount = input.matchLinkedCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team before recording builds.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "code",
          label: "Open Code Coach",
          detail: "Local pattern review stays available without inventing deploys.",
          href: hubHref("/build", "code", null),
        },
        {
          id: "cad",
          label: "Open CAD",
          detail: "Mechanical work stays separate from firmware trails.",
          href: hubHref("/build", "cad", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Code Deploy Log can load.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "code",
        label: "Open Code Coach",
        detail: "Review code context before logging the first deploy.",
        href: hubHref("/build", "code", orgId),
      },
      {
        id: "code-perf",
        label: "Open Code-vs-Match",
        detail: "Match-linked deploys pair with performance detective later.",
        href: hubHref("/build", "code-perf", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Code Deploy Log",
        detail: "Reload real deploy history.",
        href: withOrgHref("/code-deploy-log", orgId),
        primary: true,
      },
      {
        id: "code",
        label: "Open Code Coach",
        detail: "Code Coach stays available while the log reloads.",
        href: hubHref("/build", "code", orgId),
      },
      {
        id: "code-perf",
        label: "Open Code-vs-Match",
        detail: "Perf detective stays available while the log reloads.",
        href: hubHref("/build", "code-perf", orgId),
      },
    ];
  }

  if (input.shell === "empty" || deployCount === 0) {
    return [
      {
        id: "log-deploy",
        label: "Log the first deploy",
        detail: "Trails stay blank until your team records a build.",
        href: "#code-deploy-log-form",
        primary: true,
      },
      {
        id: "code",
        label: "Open Code Coach",
        detail: "Review firmware patterns before the first field deploy.",
        href: hubHref("/build", "code", orgId),
      },
      {
        id: "code-perf",
        label: "Open Code-vs-Match",
        detail: "Link match keys once deploys exist.",
        href: hubHref("/build", "code-perf", orgId),
      },
    ];
  }

  return [
    {
      id: "review-history",
      label: matchLinkedCount > 0 ? "Review match-linked deploys" : "Review deploy history",
      detail:
        matchLinkedCount > 0
          ? `${matchLinkedCount} of ${deployCount} deploy${deployCount === 1 ? "" : "s"} linked to matches.`
          : `${deployCount} real deploy${deployCount === 1 ? "" : "s"} logged — add match keys when known.`,
      href: "#code-deploy-log-history",
      primary: true,
    },
    {
      id: "code-perf",
      label: "Open Code-vs-Match",
      detail: "Trace match behavior back to firmware versions.",
      href: hubHref("/build", "code-perf", orgId),
    },
    {
      id: "code",
      label: "Open Code Coach",
      detail: "Pair deploy evidence with code review.",
      href: hubHref("/build", "code", orgId),
    },
    {
      id: "readiness-score",
      label: "Open Readiness Score",
      detail: "Carry firmware confidence into robot readiness.",
      href: hubHref("/build", "readiness-score", orgId),
    },
  ];
}
