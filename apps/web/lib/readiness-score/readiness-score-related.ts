import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Robot Readiness Score (never DEMO readiness metrics). */
export const READINESS_SCORE_RELATED_LINKS = [
  { id: "fmea", label: "FMEA", tab: "fmea" },
  { id: "inspection-copilot", label: "Inspection Copilot", tab: "inspection-copilot" },
  { id: "code", label: "Code Coach", tab: "code" },
  { id: "cad", label: "CAD", tab: "cad" },
] as const;

export type ReadinessScoreRelatedId = (typeof READINESS_SCORE_RELATED_LINKS)[number]["id"];

export type ReadinessScoreRelatedLink = {
  id: ReadinessScoreRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — FMEA / Inspection / Code. */
export const READINESS_SCORE_RELATED_INCLUDE: ReadinessScoreRelatedId[] = [
  "fmea",
  "inspection-copilot",
  "code",
];

/**
 * Soft-UI cross-links from Readiness Score → FMEA / Inspection / Code.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function readinessScoreRelatedLinks(
  orgId?: string | null,
  options?: { active?: ReadinessScoreRelatedId; include?: ReadinessScoreRelatedId[] },
): ReadinessScoreRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return READINESS_SCORE_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/build", link.tab, orgId),
  }));
}

export type ReadinessScoreShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type ReadinessScoreNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type ReadinessScoreEmptyCopy = {
  kind: ReadinessScoreShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO readiness metrics. */
export type ReadinessScoreSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function readinessScoreSetupSteps(orgId?: string | null): ReadinessScoreSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — Readiness Score is org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "fmea",
      label: "Open FMEA",
      detail: "Open failure modes stay blank until real rows exist — never DEMO RPN.",
      href: hubHref("/build", "fmea", orgId),
    },
    {
      id: "inspection-copilot",
      label: "Open Inspection Copilot",
      detail: "Weight / frame / wiring readiness stays blank until measurements exist — never DEMO risk.",
      href: hubHref("/build", "inspection-copilot", orgId),
    },
    {
      id: "code",
      label: "Open Code Coach",
      detail: "Code state stays honest without inventing DEMO deploy status.",
      href: hubHref("/build", "code", orgId),
    },
  ];
}

/** Real subsystem / checklist counts only — never invent DEMO totals. */
export function formatReadinessScoreMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Real readiness percent only — never invent DEMO ship scores. */
export function formatReadinessScorePercent(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0%";
  return `${Math.round(Math.min(1, n) * 100)}%`;
}

/** Hide zeroed summary tiles when no subsystems exist — avoids DEMO counters. */
export function shouldShowReadinessScoreSummaryTiles(subsystemCount: number): boolean {
  return subsystemCount > 0;
}

/** True when the workspace has no subsystems yet — Soft-UI empty. */
export function isReadinessScoreBoardEmpty(input: { subsystemCount: number }): boolean {
  return input.subsystemCount === 0;
}

/** Classify Readiness Score Soft-UI shell — never invents DEMO readiness metrics. */
export function classifyReadinessScoreShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  subsystemCount?: number;
}): ReadinessScoreShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if (isReadinessScoreBoardEmpty({ subsystemCount: input.subsystemCount ?? 0 })) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO readiness metrics. */
export function readinessScoreShellCopy(kind: ReadinessScoreShellKind): ReadinessScoreEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Robot Readiness…",
        description:
          "Checking workspace membership and logged subsystems — never DEMO ship scores.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Readiness Score",
        description:
          "A network or server issue blocked readiness. Retry, or open FMEA / Inspection while it reloads — never invent DEMO readiness metrics.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Readiness Score is org-scoped. Pick a workspace before logging subsystems — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No subsystems yet",
        title: "Log your first subsystem",
        description:
          "Weight, power, wiring, and code-version state ground the index. Cross-check FMEA and Inspection — never DEMO readiness metrics.",
      };
    default:
      return {
        kind: "ready",
        title: "Ship readiness from logged state",
        description:
          "The index uses only subsystems, checklist, weight/power, and open FMEA you recorded — never DEMO scores.",
      };
  }
}

/**
 * Soft-UI next actions for Readiness Score empty/setup shells.
 * Points at FMEA / Inspection / Code — never invents DEMO readiness metrics.
 */
export function readinessScoreNextActions(input: {
  orgId?: string | null;
  shell: ReadinessScoreShellKind;
  subsystemCount?: number;
  fixCount?: number;
}): ReadinessScoreNextAction[] {
  const orgId = input.orgId ?? null;
  const subsystemCount = input.subsystemCount ?? 0;
  const fixCount = input.fixCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Readiness is org-scoped — pick a team before logging subsystems.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "fmea",
          label: "Open FMEA",
          detail: "Open failure modes stay blank until real rows exist — never DEMO RPN.",
          href: hubHref("/build", "fmea", null),
        },
        {
          id: "inspection-copilot",
          label: "Open Inspection Copilot",
          detail: "Inspection readiness stays blank until measurements exist — never DEMO risk.",
          href: hubHref("/build", "inspection-copilot", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Finish membership setup so Readiness Score can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "Open failures feed the readiness fix list from real rows only.",
        href: hubHref("/build", "fmea", orgId),
      },
      {
        id: "inspection-copilot",
        label: "Open Inspection Copilot",
        detail: "Weight / frame / wiring checks sit beside the ship index.",
        href: hubHref("/build", "inspection-copilot", orgId),
      },
      {
        id: "code",
        label: "Open Code Coach",
        detail: "Code-version state pairs with subsystem deploy status.",
        href: hubHref("/build", "code", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Readiness Score",
        detail: "Reload real subsystems — nothing is invented while this fails.",
        href: withOrgHref("/readiness-score", orgId),
        primary: true,
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "Failure modes stay available while readiness reloads.",
        href: hubHref("/build", "fmea", orgId),
      },
      {
        id: "inspection-copilot",
        label: "Open Inspection Copilot",
        detail: "Inspection checks stay available while readiness reloads.",
        href: hubHref("/build", "inspection-copilot", orgId),
      },
    ];
  }

  if (input.shell === "empty" || subsystemCount === 0) {
    return [
      {
        id: "log",
        label: "Log a subsystem",
        detail: "Weight, power, wiring, and code state stay blank until you log them — never DEMO scores.",
        href: "#readiness-score-subsystem",
        primary: true,
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "Open failure modes feed the ordered fix list.",
        href: hubHref("/build", "fmea", orgId),
      },
      {
        id: "inspection-copilot",
        label: "Open Inspection Copilot",
        detail: "Pair inspection measurements with ship readiness.",
        href: hubHref("/build", "inspection-copilot", orgId),
      },
      {
        id: "code",
        label: "Open Code Coach",
        detail: "Code patterns stay separate from inventing DEMO deploy status.",
        href: hubHref("/build", "code", orgId),
      },
    ];
  }

  return [
    {
      id: "fix",
      label: fixCount > 0 ? "Work the fix list" : "Ship readiness ready",
      detail:
        fixCount > 0
          ? `${fixCount} fix item${fixCount === 1 ? "" : "s"} from logged state only — never DEMO severity.`
          : `${subsystemCount} subsystem${subsystemCount === 1 ? "" : "s"} on file — keep wiring and code honest.`,
      href: fixCount > 0 ? "#readiness-score-fixes" : "#readiness-score-subsystem",
      primary: true,
    },
    {
      id: "fmea",
      label: "Open FMEA",
      detail: "Clear open failures to raise FMEA clearance.",
      href: hubHref("/build", "fmea", orgId),
    },
    {
      id: "inspection-copilot",
      label: "Open Inspection Copilot",
      detail: "Cross-check weight and wiring against inspection limits.",
      href: hubHref("/build", "inspection-copilot", orgId),
    },
    {
      id: "code",
      label: "Open Code Coach",
      detail: "Deploy and test code so subsystem code-version state advances.",
      href: hubHref("/build", "code", orgId),
    },
  ];
}
