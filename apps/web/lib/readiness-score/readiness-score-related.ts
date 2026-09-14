import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
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
      label: "Choose your team",
      detail: "Choose your team to open Readiness Score.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "fmea",
      label: "Open FMEA",
      detail: "Open failure modes stay blank until real rows exist.",
      href: hubHref("/build", "fmea", orgId),
    },
    {
      id: "inspection-copilot",
      label: "Open Inspection Copilot",
      detail: "Weight / frame / wiring readiness stays blank until measurements exist.",
      href: hubHref("/build", "inspection-copilot", orgId),
    },
    {
      id: "code",
      label: "Open Code Coach",
      detail: "Code state stays honest and shows no sample deploy status.",
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

/** True when the team has no subsystems yet — Soft-UI empty. */
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
          "Checking which team you are on and logged subsystems.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Readiness Score",
        description:
          "A network or server issue blocked readiness. Retry, or open FMEA / Inspection while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before logging subsystems.",
      };
    case "empty":
      return {
        kind,
        badge: "No subsystems yet",
        title: "Log your first subsystem",
        description:
          "Weight, power, wiring, and code-version state ground the index. Cross-check FMEA and Inspection.",
      };
    default:
      return {
        kind: "ready",
        title: "Ship readiness from logged state",
        description:
          "The index uses only subsystems, checklist, weight/power, and open FMEA you recorded.",
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
    // One list, not two: the setup shell offers exactly the setup steps. These
    // used to be a second hand-written copy of readinessScoreSetupSteps with the same ids and
    // different wording, so the screen showed the same guided list twice.
    return setupActionsFrom(readinessScoreSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Readiness Score",
        detail: "Reload real subsystems.",
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
        detail: "Weight, power, wiring, and code state stay blank until you log them.",
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
        detail: "Code patterns are tracked separately from deploy status.",
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
          ? `${fixCount} fix item${fixCount === 1 ? "" : "s"} from logged state only.`
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
