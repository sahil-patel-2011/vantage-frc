import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Judge pitch (never DEMO judge metrics). */
export const JUDGE_SIM_RELATED_LINKS = [
  { id: "impact", label: "Impact", kind: "hub" as const, tab: "impact" },
  { id: "impact-essay", label: "Impact essay", kind: "hub" as const, tab: "impact-essay" },
  { id: "evidence", label: "Awards", kind: "hub" as const, tab: "evidence" },
  { id: "award-tracker", label: "Award tracker", kind: "hub" as const, tab: "award-tracker" },
  { id: "media-kit", label: "Media kit", kind: "hub" as const, tab: "media-kit" },
] as const;

export type JudgeSimRelatedId = (typeof JUDGE_SIM_RELATED_LINKS)[number]["id"];

export type JudgeSimRelatedLink = {
  id: JudgeSimRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Impact / Impact essay / Awards first. */
export const JUDGE_SIM_RELATED_INCLUDE: JudgeSimRelatedId[] = ["impact", "impact-essay", "evidence"];

/**
 * Soft-UI cross-links from Judge pitch → Impact / Essay / Awards.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function judgeSimRelatedLinks(
  orgId?: string | null,
  options?: { active?: JudgeSimRelatedId; include?: JudgeSimRelatedId[] },
): JudgeSimRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return JUDGE_SIM_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/business", link.tab, orgId),
  }));
}

export type JudgeSimShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type JudgeSimNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type JudgeSimEmptyCopy = {
  kind: JudgeSimShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real session / evidence counts only — never invent DEMO judge totals. */
export function formatJudgeSimMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Readiness share as a percent string — only for real graded sessions, never DEMO. */
export function formatJudgeSimReadiness(score: unknown, sessionCount: number, loaded: boolean): string {
  if (!loaded) return "…";
  if (sessionCount <= 0) return "—";
  const n = Number(score ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0%";
  return `${Math.round(Math.min(1, n) * 100)}%`;
}

/** Hide zeroed readiness tiles when nothing has been graded — avoids DEMO counters. */
export function shouldShowJudgeSimSummaryTiles(sessionCount: number): boolean {
  return sessionCount > 0;
}

/** Classify Judge pitch Soft-UI shell — never invents DEMO judge metrics. */
export function classifyJudgeSimShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  sessionCount?: number;
}): JudgeSimShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.sessionCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO judge metrics. */
export function judgeSimShellCopy(kind: JudgeSimShellKind): JudgeSimEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Opening Judge pitch",
        description:
          "Checking which team you are on and logged evidence.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Judge pitch",
        description:
          "A network or server issue blocked Judge pitch. Retry, or open Impact / Impact essay / Awards while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team and log real evidence before grading answers.",
      };
    case "empty":
      return {
        kind,
        badge: "No sessions yet",
        title: "Run your first judge Q&A",
        description:
          "Graded sessions stay blank until you log evidence and answer a judging question. Cross-check Impact, Impact essay, and Awards.",
      };
    default:
      return {
        kind: "ready",
        title: "Judge-pitch practice",
        description:
          "Verdicts cite only claims matched to your logged evidence.",
      };
  }
}

/**
 * Soft-UI next actions for Judge pitch empty/setup shells.
 * Points at Impact / Essay / Awards — never invents DEMO judge metrics.
 */
export function judgeSimNextActions(input: {
  orgId?: string | null;
  shell: JudgeSimShellKind;
  sessionCount?: number;
  evidenceCount?: number;
}): JudgeSimNextAction[] {
  const orgId = input.orgId ?? null;
  const sessionCount = input.sessionCount ?? 0;
  const evidenceCount = input.evidenceCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose your team before logging evidence.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "impact",
          label: "Open Impact",
          detail: "Outreach rows stay blank until your team logs them.",
          href: hubHref("/business", "impact", null),
        },
        {
          id: "impact-essay",
          label: "Open Impact essay",
          detail: "Essay drafts stay empty until real activities exist.",
          href: hubHref("/business", "impact-essay", null),
        },
        {
          id: "evidence",
          label: "Open Awards",
          detail: "Award evidence stays blank until your team uploads it.",
          href: hubHref("/business", "evidence", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Judge pitch can load.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "impact",
        label: "Open Impact",
        detail: "Ground outreach claims in real logged activities.",
        href: hubHref("/business", "impact", orgId),
      },
      {
        id: "impact-essay",
        label: "Open Impact essay",
        detail: "Draft award language from real impact rows.",
        href: hubHref("/business", "impact-essay", orgId),
      },
      {
        id: "evidence",
        label: "Open Awards",
        detail: "Keep award packets grounded in uploaded evidence.",
        href: hubHref("/business", "evidence", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Judge pitch",
        detail: "Reload real evidence and session rows.",
        href: withOrgHref("/judge-sim", orgId),
        primary: true,
      },
      {
        id: "impact",
        label: "Open Impact",
        detail: "Impact rows stay available while Judge pitch reloads.",
        href: hubHref("/business", "impact", orgId),
      },
      {
        id: "impact-essay",
        label: "Open Impact essay",
        detail: "Essay drafts stay available while Judge pitch reloads.",
        href: hubHref("/business", "impact-essay", orgId),
      },
      {
        id: "evidence",
        label: "Open Awards",
        detail: "Award evidence stays available while Judge pitch reloads.",
        href: hubHref("/business", "evidence", orgId),
      },
    ];
  }

  if (input.shell === "empty" || sessionCount === 0) {
    const actions: JudgeSimNextAction[] = [];
    if (evidenceCount === 0) {
      actions.push({
        id: "log-evidence",
        label: "Log evidence",
        detail: "Answers stay unbacked until real facts land in the evidence log.",
        href: "#judge-sim-evidence",
        primary: true,
      });
    } else {
      actions.push({
        id: "run-session",
        label: "Grade a judge answer",
        detail: "Practice against your logged evidence.",
        href: "#judge-sim-session",
        primary: true,
      });
    }
    actions.push(
      {
        id: "impact",
        label: "Cross-check Impact",
        detail: "Outreach claims cite only real logged activities.",
        href: hubHref("/business", "impact", orgId),
      },
      {
        id: "impact-essay",
        label: "Open Impact essay",
        detail: "Award language stays grounded in real impact.",
        href: hubHref("/business", "impact-essay", orgId),
      },
      {
        id: "evidence",
        label: "Open Awards",
        detail: "Award packets stay blank until real uploads exist.",
        href: hubHref("/business", "evidence", orgId),
      },
    );
    return actions.slice(0, 4);
  }

  const actions: JudgeSimNextAction[] = [
    {
      id: "review-sessions",
      label: "Review graded sessions",
      detail: `${sessionCount} graded session${sessionCount === 1 ? "" : "s"} from real evidence matches.`,
      href: "#judge-sim-sessions",
      primary: true,
    },
    {
      id: "log-evidence",
      label: "Log more evidence",
      detail:
        evidenceCount > 0
          ? `${evidenceCount} evidence row${evidenceCount === 1 ? "" : "s"} on record — keep claims judge-ready.`
          : "Add facts before the next judge Q&A.",
      href: "#judge-sim-evidence",
    },
    {
      id: "impact",
      label: "Open Impact",
      detail: "Ground outreach answers in real logged activities.",
      href: hubHref("/business", "impact", orgId),
    },
    {
      id: "impact-essay",
      label: "Open Impact essay",
      detail: "Turn backed claims into award language.",
      href: hubHref("/business", "impact-essay", orgId),
    },
    {
      id: "evidence",
      label: "Open Awards",
      detail: "Keep award packets grounded in uploaded evidence.",
      href: hubHref("/business", "evidence", orgId),
    },
  ];

  return actions.slice(0, 5);
}
