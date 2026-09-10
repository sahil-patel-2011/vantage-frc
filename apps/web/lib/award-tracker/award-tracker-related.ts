import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Award Tracker (never DEMO win rates). */
export const AWARD_TRACKER_RELATED_LINKS = [
  { id: "evidence", label: "Business · Awards", kind: "business" as const, tab: "evidence" },
  { id: "awards-workbench", label: "Awards workbench", kind: "path" as const, path: "/team/awards" },
  { id: "impact-essay", label: "Impact essay", kind: "business" as const, tab: "impact-essay" },
  { id: "judge-sim", label: "Judge-Pitch", kind: "business" as const, tab: "judge-sim" },
] as const;

export type AwardTrackerRelatedId = (typeof AWARD_TRACKER_RELATED_LINKS)[number]["id"];

export type AwardTrackerRelatedLink = {
  id: AwardTrackerRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Awards / Awards workbench / Impact essay. */
export const AWARD_TRACKER_RELATED_INCLUDE: AwardTrackerRelatedId[] = [
  "evidence",
  "awards-workbench",
  "impact-essay",
];

/**
 * Soft-UI cross-links from Award Tracker → Awards / Essay.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function awardTrackerRelatedLinks(
  orgId?: string | null,
  options?: { active?: AwardTrackerRelatedId; include?: AwardTrackerRelatedId[] },
): AwardTrackerRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return AWARD_TRACKER_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "business") {
      return { id: link.id, label: link.label, href: hubHref("/business", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type AwardTrackerShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type AwardTrackerNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type AwardTrackerEmptyCopy = {
  kind: AwardTrackerShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO win rates. */
export type AwardTrackerSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function awardTrackerSetupSteps(orgId?: string | null): AwardTrackerSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open award submissions.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "evidence",
      label: "Open Awards",
      detail: "Award evidence stays blank until your team uploads it.",
      href: hubHref("/business", "evidence", orgId),
    },
    {
      id: "awards-workbench",
      label: "Open Awards workbench",
      detail: "Submission packets stay empty until real uploads exist.",
      href: withOrgHref("/team/awards", orgId),
    },
    {
      id: "impact-essay",
      label: "Open Impact Essay",
      detail: "Essay drafts stay blank until grounded outreach exists.",
      href: hubHref("/business", "impact-essay", orgId),
    },
  ];
}

/** Real submission counts only — never invent DEMO totals. */
export function formatAwardTrackerMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Progress share — blank until real submissions exist; never invent DEMO win rates. */
export function formatAwardTrackerProgress(value: unknown, submissionCount: number, loaded: boolean): string {
  if (!loaded) return "…";
  if (submissionCount <= 0) return "—";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0%";
  return `${Math.round(Math.min(1, n) * 100)}%`;
}

/** Hide zeroed summary tiles when nothing is tracked — avoids DEMO counters. */
export function shouldShowAwardTrackerSummaryTiles(submissionCount: number): boolean {
  return submissionCount > 0;
}

/** True when the team has no submissions yet — Soft-UI empty. */
export function isAwardTrackerBoardEmpty(input: { submissionCount: number }): boolean {
  return input.submissionCount === 0;
}

/** Classify Award Tracker Soft-UI shell — never invents DEMO win rates. */
export function classifyAwardTrackerShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  submissionCount?: number;
}): AwardTrackerShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if (isAwardTrackerBoardEmpty({ submissionCount: input.submissionCount ?? 0 })) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO win rates. */
export function awardTrackerShellCopy(kind: AwardTrackerShellKind): AwardTrackerEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Award Tracker…",
        description:
          "Checking which team you are on and award submissions.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Award Tracker",
        description:
          "A network or server issue blocked the tracker. Retry, or open Awards / Impact Essay while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Choose your team",
        description:
          "Choose your team and log real submissions before tracking deadlines.",
      };
    case "empty":
      return {
        kind,
        badge: "No submissions yet",
        title: "Track your first award submission",
        description:
          "Deadlines and status stay blank until you log an award, event, and due date. Cross-check Awards and Impact Essay.",
      };
    default:
      return {
        kind: "ready",
        title: "Award submission deadlines",
        description:
          "Counts reflect submissions you start.",
      };
  }
}

/**
 * Soft-UI next actions for Award Tracker empty/setup shells.
 * Points at Awards / Impact Essay — never invents DEMO win rates.
 */
export function awardTrackerNextActions(input: {
  orgId?: string | null;
  shell: AwardTrackerShellKind;
  submissionCount?: number;
  dueSoonCount?: number;
}): AwardTrackerNextAction[] {
  const orgId = input.orgId ?? null;
  const submissionCount = input.submissionCount ?? 0;
  const dueSoonCount = input.dueSoonCount ?? 0;

  if (!orgId || input.shell === "setup") {
    // One list, not two: the setup shell offers exactly the setup steps. These
    // used to be a second hand-written copy of awardTrackerSetupSteps with the same ids and
    // different wording, so the screen showed the same guided list twice.
    return setupActionsFrom(awardTrackerSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Award Tracker",
        detail: "Reload real submissions and deadlines.",
        href: withOrgHref("/award-tracker", orgId),
        primary: true,
      },
      {
        id: "evidence",
        label: "Open Awards",
        detail: "Award evidence stays available while the tracker reloads.",
        href: hubHref("/business", "evidence", orgId),
      },
      {
        id: "impact-essay",
        label: "Open Impact Essay",
        detail: "Essay drafts stay available while the tracker reloads.",
        href: hubHref("/business", "impact-essay", orgId),
      },
    ];
  }

  if (input.shell === "empty" || submissionCount === 0) {
    return [
      {
        id: "track",
        label: "Track a submission",
        detail: "Deadlines stay blank until you log a real award.",
        href: "#award-tracker-create",
        primary: true,
      },
      {
        id: "evidence",
        label: "Open Awards",
        detail: "Ground packets in uploaded evidence.",
        href: hubHref("/business", "evidence", orgId),
      },
      {
        id: "impact-essay",
        label: "Open Impact Essay",
        detail: "Essay drafts stay empty until real outreach lands.",
        href: hubHref("/business", "impact-essay", orgId),
      },
    ];
  }

  const actions: AwardTrackerNextAction[] = [
    {
      id: "track-more",
      label: "Track another submission",
      detail:
        dueSoonCount > 0
          ? `${dueSoonCount} deadline${dueSoonCount === 1 ? "" : "s"} due soon — only real rows.`
          : `${submissionCount} submission${submissionCount === 1 ? "" : "s"} on record.`,
      href: "#award-tracker-create",
      primary: true,
    },
    {
      id: "evidence",
      label: "Open Awards",
      detail: "Keep packets grounded in uploaded evidence.",
      href: hubHref("/business", "evidence", orgId),
    },
    {
      id: "awards-workbench",
      label: "Open Awards workbench",
      detail: "Review workbench packets next to tracked deadlines.",
      href: withOrgHref("/team/awards", orgId),
    },
    {
      id: "impact-essay",
      label: "Open Impact Essay",
      detail: "Pair submission timelines with grounded essay drafts.",
      href: hubHref("/business", "impact-essay", orgId),
    },
  ];

  return actions.slice(0, 5);
}
