import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Sponsor Suite (never DEMO fundraising metrics). */
export const SPONSOR_SUITE_RELATED_LINKS = [
  { id: "sponsors", label: "Sponsor CRM", kind: "business" as const, tab: "sponsors" },
  { id: "sponsorship", label: "Sponsorship", kind: "business" as const, tab: "sponsorship" },
  { id: "sponsor-wall", label: "Sponsor Wall", kind: "business" as const, tab: "sponsor-wall" },
  { id: "media-kit", label: "Media kit", kind: "business" as const, tab: "media-kit" },
] as const;

export type SponsorSuiteRelatedId = (typeof SPONSOR_SUITE_RELATED_LINKS)[number]["id"];

export type SponsorSuiteRelatedLink = {
  id: SponsorSuiteRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — CRM / Sponsorship / Sponsor Wall. */
export const SPONSOR_SUITE_RELATED_INCLUDE: SponsorSuiteRelatedId[] = [
  "sponsors",
  "sponsorship",
  "sponsor-wall",
];

/**
 * Soft-UI cross-links from Sponsor Suite → CRM / Sponsorship / Wall.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function sponsorSuiteRelatedLinks(
  orgId?: string | null,
  options?: { active?: SponsorSuiteRelatedId; include?: SponsorSuiteRelatedId[] },
): SponsorSuiteRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return SPONSOR_SUITE_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/business", link.tab, orgId),
  }));
}

export type SponsorSuiteShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type SponsorSuiteNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type SponsorSuiteEmptyCopy = {
  kind: SponsorSuiteShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO fundraising metrics. */
export type SponsorSuiteSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function sponsorSuiteSetupSteps(orgId?: string | null): SponsorSuiteSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open sponsor suite.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "sponsors",
      label: "Open Sponsor CRM",
      detail: "Sponsor rows stay blank until your team logs them.",
      href: hubHref("/business", "sponsors", orgId),
    },
    {
      id: "sponsorship",
      label: "Open Sponsorship",
      detail: "One-pagers stay empty until real packages exist.",
      href: hubHref("/business", "sponsorship", orgId),
    },
    {
      id: "sponsor-wall",
      label: "Open Sponsor Wall",
      detail: "Wall shout-outs stay blank until real entries land.",
      href: hubHref("/business", "sponsor-wall", orgId),
    },
  ];
}

/** Real sponsor / deck counts only — never invent DEMO totals. */
export function formatSponsorSuiteMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when nothing is recorded — avoids DEMO counters. */
export function shouldShowSponsorSuiteSummaryTiles(input: {
  sponsorCount: number;
  deckCount: number;
  reminderCount: number;
  hasGoal: boolean;
}): boolean {
  return (
    input.sponsorCount > 0 || input.deckCount > 0 || input.reminderCount > 0 || input.hasGoal
  );
}

/** True when the suite has no sponsors or generated assets yet — Soft-UI empty. */
export function isSponsorSuiteBoardEmpty(input: {
  sponsorCount: number;
  deckCount: number;
  reminderCount: number;
  roiReportCount: number;
  hasGoal: boolean;
}): boolean {
  return (
    input.sponsorCount === 0 &&
    input.deckCount === 0 &&
    input.reminderCount === 0 &&
    input.roiReportCount === 0 &&
    !input.hasGoal
  );
}

/** Classify Sponsor Suite Soft-UI shell — never invents DEMO fundraising metrics. */
export function classifySponsorSuiteShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  sponsorCount?: number;
  deckCount?: number;
  reminderCount?: number;
  roiReportCount?: number;
  hasGoal?: boolean;
}): SponsorSuiteShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if (
    isSponsorSuiteBoardEmpty({
      sponsorCount: input.sponsorCount ?? 0,
      deckCount: input.deckCount ?? 0,
      reminderCount: input.reminderCount ?? 0,
      roiReportCount: input.roiReportCount ?? 0,
      hasGoal: input.hasGoal ?? false,
    })
  ) {
    return "empty";
  }
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO fundraising metrics. */
export function sponsorSuiteShellCopy(kind: SponsorSuiteShellKind): SponsorSuiteEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Sponsor Suite…",
        description:
          "Checking which team you are on and recorded sponsors.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Sponsor Suite",
        description:
          "A network or server issue blocked the suite. Retry, or open Sponsor CRM / Sponsorship while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team and log real sponsors before generating decks.",
      };
    case "empty":
      return {
        kind,
        badge: "No sponsors yet",
        title: "Add sponsors before building the suite",
        description:
          "Goals, decks, ROI reports, and reminders stay blank until real CRM sponsors exist. Cross-check Sponsor CRM and Sponsorship.",
      };
    default:
      return {
        kind: "ready",
        title: "Pitch, renew, and report",
        description:
          "Decks and ROI reports ground only in recorded sponsors and contributions.",
      };
  }
}

/**
 * Soft-UI next actions for Sponsor Suite empty/setup shells.
 * Points at CRM / Sponsorship / Wall — never invents DEMO fundraising metrics.
 */
export function sponsorSuiteNextActions(input: {
  orgId?: string | null;
  shell: SponsorSuiteShellKind;
  sponsorCount?: number;
  deckCount?: number;
}): SponsorSuiteNextAction[] {
  const orgId = input.orgId ?? null;
  const sponsorCount = input.sponsorCount ?? 0;
  const deckCount = input.deckCount ?? 0;

  if (!orgId || input.shell === "setup") {
    // One list, not two: the setup shell offers exactly the setup steps. These
    // used to be a second hand-written copy of sponsorSuiteSetupSteps with the same ids and
    // different wording, so the screen showed the same guided list twice.
    return setupActionsFrom(sponsorSuiteSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Sponsor Suite",
        detail: "Reload real sponsors and decks.",
        href: withOrgHref("/sponsor-suite", orgId),
        primary: true,
      },
      {
        id: "sponsors",
        label: "Open Sponsor CRM",
        detail: "Sponsor rows stay available while the suite reloads.",
        href: hubHref("/business", "sponsors", orgId),
      },
      {
        id: "sponsorship",
        label: "Open Sponsorship",
        detail: "Sponsorship materials stay available while the suite reloads.",
        href: hubHref("/business", "sponsorship", orgId),
      },
    ];
  }

  if (input.shell === "empty" || sponsorCount === 0) {
    return [
      {
        id: "sponsors",
        label: "Open Sponsor CRM",
        detail: "Log real sponsors before generating decks.",
        href: hubHref("/business", "sponsors", orgId),
        primary: true,
      },
      {
        id: "goal",
        label: "Set a season goal",
        detail: "Goal progress stays blank until you set one.",
        href: "#sponsor-suite-goal",
      },
      {
        id: "sponsorship",
        label: "Open Sponsorship",
        detail: "Align suite language with real package tiers.",
        href: hubHref("/business", "sponsorship", orgId),
      },
    ];
  }

  const actions: SponsorSuiteNextAction[] = [
    {
      id: "deck",
      label: deckCount > 0 ? "Generate another deck" : "Generate a pitch deck",
      detail:
        deckCount > 0
          ? `${deckCount} deck${deckCount === 1 ? "" : "s"} grounded in recorded sponsors — metered.`
          : "Pitch/renewal decks are metered and grounded in real CRM sponsors.",
      href: "#sponsor-suite-decks",
      primary: true,
    },
    {
      id: "sponsors",
      label: "Open Sponsor CRM",
      detail: `${sponsorCount} sponsor${sponsorCount === 1 ? "" : "s"} in CRM — keep decks grounded.`,
      href: hubHref("/business", "sponsors", orgId),
    },
    {
      id: "sponsor-wall",
      label: "Open Sponsor Wall",
      detail: "Pair suite shout-outs with wall entries.",
      href: hubHref("/business", "sponsor-wall", orgId),
    },
    {
      id: "media-kit",
      label: "Open Media kit",
      detail: "Keep press assets grounded in recorded logos and bios.",
      href: hubHref("/business", "media-kit", orgId),
    },
  ];

  return actions.slice(0, 5);
}
