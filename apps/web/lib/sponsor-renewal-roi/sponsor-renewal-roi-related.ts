import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Sponsor Renewal ROI (never DEMO churn scores). */
export const SPONSOR_RENEWAL_ROI_RELATED_LINKS = [
  { id: "sponsors", label: "Sponsor CRM", kind: "business" as const, tab: "sponsors" },
  { id: "sponsor-suite", label: "Sponsor Suite", kind: "business" as const, tab: "sponsor-suite" },
  { id: "sponsor-wall", label: "Sponsor Wall", kind: "business" as const, tab: "sponsor-wall" },
  { id: "impact", label: "Community Impact", kind: "business" as const, tab: "impact" },
] as const;

export type SponsorRenewalRoiRelatedId = (typeof SPONSOR_RENEWAL_ROI_RELATED_LINKS)[number]["id"];

export type SponsorRenewalRoiRelatedLink = {
  id: SponsorRenewalRoiRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — CRM / Suite / Impact. */
export const SPONSOR_RENEWAL_ROI_RELATED_INCLUDE: SponsorRenewalRoiRelatedId[] = [
  "sponsors",
  "sponsor-suite",
  "impact",
];

/**
 * Soft-UI cross-links from Sponsor Renewal ROI → CRM / Suite / Impact.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function sponsorRenewalRoiRelatedLinks(
  orgId?: string | null,
  options?: { active?: SponsorRenewalRoiRelatedId; include?: SponsorRenewalRoiRelatedId[] },
): SponsorRenewalRoiRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return SPONSOR_RENEWAL_ROI_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/business", link.tab, orgId),
  }));
}

export type SponsorRenewalRoiShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type SponsorRenewalRoiNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type SponsorRenewalRoiEmptyCopy = {
  kind: SponsorRenewalRoiShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type SponsorRenewalRoiSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function sponsorRenewalRoiSetupSteps(orgId?: string | null): SponsorRenewalRoiSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open renewal scores.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "sponsors",
      label: "Open Sponsor CRM",
      detail: "Sponsor rows stay blank until your team logs them.",
      href: hubHref("/business", "sponsors", orgId),
    },
    {
      id: "impact",
      label: "Open Community Impact",
      detail: "Impact mentions feed renewal evidence.",
      href: hubHref("/business", "impact", orgId),
    },
    {
      id: "sponsor-suite",
      label: "Open Sponsor Suite",
      detail: "Suite assets stay blank until real sponsors land.",
      href: hubHref("/business", "sponsor-suite", orgId),
    },
  ];
}

/** Real sponsor / scored counts only — never invent DEMO totals. */
export function formatSponsorRenewalRoiMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when no sponsors exist — avoids DEMO counters. */
export function shouldShowSponsorRenewalRoiSummaryTiles(sponsorCount: number): boolean {
  return sponsorCount > 0;
}

/** Classify Sponsor Renewal ROI Soft-UI shell — never invents DEMO churn scores. */
export function classifySponsorRenewalRoiShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  sponsorCount?: number;
}): SponsorRenewalRoiShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.sponsorCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO churn scores. */
export function sponsorRenewalRoiShellCopy(kind: SponsorRenewalRoiShellKind): SponsorRenewalRoiEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Sponsor Renewal ROI…",
        description: "Checking which team you are on and sponsor CRM.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Sponsor Renewal ROI",
        description:
          "A network or server issue blocked renewal scoring. Retry, or open Sponsor CRM while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Add sponsors before scoring renewal risk",
        description:
          "Renewal ROI needs an org and at least one CRM sponsor. Scores stay blank until interactions, contributions, or impact mentions exist.",
      };
    case "empty":
      return {
        kind,
        badge: "No sponsors yet",
        title: "Log sponsors in the CRM first",
        description:
          "Risk scores appear only after real sponsors and linked activity exist.",
      };
    default:
      return {
        kind: "ready",
        title: "Renewal-risk scores from real activity",
        description:
          "Scores use logged interactions, contributions, and impact mentions only.",
      };
  }
}

/**
 * Soft-UI next actions for Sponsor Renewal ROI empty/setup shells.
 * Points at CRM / Suite / Impact — never invents DEMO churn scores.
 */
export function sponsorRenewalRoiNextActions(input: {
  orgId?: string | null;
  shell: SponsorRenewalRoiShellKind;
  sponsorCount?: number;
  scoredCount?: number;
}): SponsorRenewalRoiNextAction[] {
  const orgId = input.orgId ?? null;
  const sponsorCount = input.sponsorCount ?? 0;
  const scoredCount = input.scoredCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose your team before scoring sponsors.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "sponsors",
          label: "Open Sponsor CRM",
          detail: "Sponsor rows stay blank until your team logs them.",
          href: hubHref("/business", "sponsors", null),
        },
        {
          id: "impact",
          label: "Open Community Impact",
          detail: "Impact mentions feed renewal evidence.",
          href: hubHref("/business", "impact", null),
        },
      ];
    }
    return [
      {
        id: "sponsors",
        label: "Open Sponsor CRM",
        detail: "Add at least one sponsor before renewal scoring can run.",
        href: hubHref("/business", "sponsors", orgId),
        primary: true,
      },
      {
        id: "impact",
        label: "Open Community Impact",
        detail: "Log impact mentions that name sponsors for evidence coverage.",
        href: hubHref("/business", "impact", orgId),
      },
      {
        id: "sponsor-suite",
        label: "Open Sponsor Suite",
        detail: "Suite assets stay blank until real sponsors land.",
        href: hubHref("/business", "sponsor-suite", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Sponsor Renewal ROI",
        detail: "Reload real renewal scores.",
        href: withOrgHref("/sponsor-renewal-roi", orgId),
        primary: true,
      },
      {
        id: "sponsors",
        label: "Open Sponsor CRM",
        detail: "CRM stays available while renewal scores reload.",
        href: hubHref("/business", "sponsors", orgId),
      },
      {
        id: "impact",
        label: "Open Community Impact",
        detail: "Impact stays available while renewal scores reload.",
        href: hubHref("/business", "impact", orgId),
      },
    ];
  }

  if (input.shell === "empty" || sponsorCount === 0) {
    return [
      {
        id: "sponsors",
        label: "Add a sponsor",
        detail: "Scores stay blank until CRM sponsors exist.",
        href: hubHref("/business", "sponsors", orgId),
        primary: true,
      },
      {
        id: "impact",
        label: "Log community impact",
        detail: "Mentions naming sponsors strengthen evidence coverage.",
        href: hubHref("/business", "impact", orgId),
      },
      {
        id: "sponsor-wall",
        label: "Open Sponsor Wall",
        detail: "Public wall stays blank until real sponsors are featured.",
        href: hubHref("/business", "sponsor-wall", orgId),
      },
    ];
  }

  return [
    {
      id: scoredCount > 0 ? "review-scores" : "link-activity",
      label: scoredCount > 0 ? "Review renewal-risk scores" : "Link sponsor activity",
      detail:
        scoredCount > 0
          ? `${scoredCount} of ${sponsorCount} sponsor${sponsorCount === 1 ? "" : "s"} scored from real activity.`
          : `${sponsorCount} sponsor${sponsorCount === 1 ? "" : "s"} need interactions or contributions before scoring.`,
      href: scoredCount > 0 ? "#sponsor-renewal-roi-list" : hubHref("/business", "sponsors", orgId),
      primary: true,
    },
    {
      id: "sponsors",
      label: "Open Sponsor CRM",
      detail: "Log interactions and contributions that feed the score.",
      href: hubHref("/business", "sponsors", orgId),
    },
    {
      id: "impact",
      label: "Open Community Impact",
      detail: "Impact mentions naming sponsors raise evidence coverage.",
      href: hubHref("/business", "impact", orgId),
    },
    {
      id: "sponsor-suite",
      label: "Open Sponsor Suite",
      detail: "Pair ROI reports with suite assets for renewals.",
      href: hubHref("/business", "sponsor-suite", orgId),
    },
  ];
}
