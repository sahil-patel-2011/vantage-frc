import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Matching Gift Finder (never DEMO matches or pledges). */
export const MATCHING_GIFT_FINDER_RELATED_LINKS = [
  { id: "sponsors", label: "Sponsor CRM", kind: "business" as const, tab: "sponsors" },
  { id: "sponsor-renewal-roi", label: "Sponsor Renewal ROI", kind: "business" as const, tab: "sponsor-renewal-roi" },
  { id: "impact", label: "Community Impact", kind: "business" as const, tab: "impact" },
  { id: "fundraisers", label: "Fundraisers", kind: "business" as const, tab: "fundraisers" },
] as const;

export type MatchingGiftFinderRelatedId = (typeof MATCHING_GIFT_FINDER_RELATED_LINKS)[number]["id"];

export type MatchingGiftFinderRelatedLink = {
  id: MatchingGiftFinderRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — CRM / Renewal ROI / Impact. */
export const MATCHING_GIFT_FINDER_RELATED_INCLUDE: MatchingGiftFinderRelatedId[] = [
  "sponsors",
  "sponsor-renewal-roi",
  "impact",
];

/**
 * Soft-UI cross-links from Matching Gift Finder → CRM / Renewal / Impact.
 * Build with hubHref — never broken JSX href templates.
 */
export function matchingGiftFinderRelatedLinks(
  orgId?: string | null,
  options?: { active?: MatchingGiftFinderRelatedId; include?: MatchingGiftFinderRelatedId[] },
): MatchingGiftFinderRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return MATCHING_GIFT_FINDER_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/business", link.tab, orgId),
  }));
}

export type MatchingGiftFinderShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type MatchingGiftFinderNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type MatchingGiftFinderEmptyCopy = {
  kind: MatchingGiftFinderShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type MatchingGiftFinderSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function matchingGiftFinderSetupSteps(orgId?: string | null): MatchingGiftFinderSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open matching gifts.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "contacts",
      label: "Add a household contact",
      detail: "Parents, alumni, or mentors with an employer unlock matches.",
      href: orgId ? withOrgHref("/matching-gift-finder", orgId) : "/matching-gift-finder",
    },
    {
      id: "sponsors",
      label: "Open Sponsor CRM",
      detail: "Sponsor relationships stay separate from household employer matches.",
      href: hubHref("/business", "sponsors", orgId),
    },
    {
      id: "impact",
      label: "Open Community Impact",
      detail: "Impact stories can support matching-gift request letters.",
      href: hubHref("/business", "impact", orgId),
    },
  ];
}

/** Real contact / match counts only — never invent DEMO totals. */
export function formatMatchingGiftFinderMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when no contacts exist — avoids DEMO counters. */
export function shouldShowMatchingGiftFinderSummaryTiles(contactCount: number): boolean {
  return contactCount > 0;
}

/** Classify Matching Gift Finder Soft-UI shell — never invents DEMO matches. */
export function classifyMatchingGiftFinderShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  contactCount?: number;
}): MatchingGiftFinderShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.contactCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO matches or pledges. */
export function matchingGiftFinderShellCopy(kind: MatchingGiftFinderShellKind): MatchingGiftFinderEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Matching Gift Finder…",
        description: "Checking which team you are on and household contacts.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Matching Gift Finder",
        description:
          "A network or server issue blocked matching. Retry, or open Sponsor CRM while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Choose your team",
        description:
          "Choose your team before adding household employers.",
      };
    case "empty":
      return {
        kind,
        badge: "No contacts yet",
        title: "Add a household employer contact",
        description:
          "Matches appear only after real contacts and tracked programs exist.",
      };
    default:
      return {
        kind: "ready",
        title: "Employer matches from recorded contacts",
        description:
          "Matches and pledges use your household contacts and programs only.",
      };
  }
}

/**
 * Soft-UI next actions for Matching Gift Finder empty/setup shells.
 * Points at CRM / Renewal / Impact — never invents DEMO matches.
 */
export function matchingGiftFinderNextActions(input: {
  orgId?: string | null;
  shell: MatchingGiftFinderShellKind;
  contactCount?: number;
  matchCount?: number;
}): MatchingGiftFinderNextAction[] {
  const orgId = input.orgId ?? null;
  const contactCount = input.contactCount ?? 0;
  const matchCount = input.matchCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose your team before adding contacts.",
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
          detail: "Impact stays available without inventing matches.",
          href: hubHref("/business", "impact", null),
        },
      ];
    }
    return [
      {
        id: "contacts",
        label: "Add a household contact",
        detail: "Employer names unlock program matches.",
        href: withOrgHref("/matching-gift-finder", orgId) + "#matching-gift-contacts",
        primary: true,
      },
      {
        id: "sponsors",
        label: "Open Sponsor CRM",
        detail: "Corporate sponsors stay separate from household matching gifts.",
        href: hubHref("/business", "sponsors", orgId),
      },
      {
        id: "sponsor-renewal-roi",
        label: "Open Sponsor Renewal ROI",
        detail: "Renewal risk stays blank until CRM activity exists.",
        href: hubHref("/business", "sponsor-renewal-roi", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Matching Gift Finder",
        detail: "Reload real contacts and programs.",
        href: withOrgHref("/matching-gift-finder", orgId),
        primary: true,
      },
      {
        id: "sponsors",
        label: "Open Sponsor CRM",
        detail: "CRM stays available while matching reloads.",
        href: hubHref("/business", "sponsors", orgId),
      },
      {
        id: "impact",
        label: "Open Community Impact",
        detail: "Impact stays available while matching reloads.",
        href: hubHref("/business", "impact", orgId),
      },
    ];
  }

  if (input.shell === "empty" || contactCount === 0) {
    return [
      {
        id: "add-contact",
        label: "Add the first contact",
        detail: "Matches stay blank until household employers exist.",
        href: "#matching-gift-contacts",
        primary: true,
      },
      {
        id: "sponsors",
        label: "Open Sponsor CRM",
        detail: "Corporate sponsors remain separate from household matching gifts.",
        href: hubHref("/business", "sponsors", orgId),
      },
      {
        id: "impact",
        label: "Open Community Impact",
        detail: "Impact stories can support HR request letters later.",
        href: hubHref("/business", "impact", orgId),
      },
    ];
  }

  return [
    {
      id: matchCount > 0 ? "review-matches" : "add-programs",
      label: matchCount > 0 ? "Review employer matches" : "Track employer programs",
      detail:
        matchCount > 0
          ? `${matchCount} match${matchCount === 1 ? "" : "es"} from recorded contacts.`
          : `${contactCount} contact${contactCount === 1 ? "" : "s"} need matching programs before pledges.`,
      href: matchCount > 0 ? "#matching-gift-matches" : "#matching-gift-programs",
      primary: true,
    },
    {
      id: "sponsors",
      label: "Open Sponsor CRM",
      detail: "Pair household matches with corporate sponsor renewals.",
      href: hubHref("/business", "sponsors", orgId),
    },
    {
      id: "sponsor-renewal-roi",
      label: "Open Sponsor Renewal ROI",
      detail: "Renewal scores stay grounded in CRM activity only.",
      href: hubHref("/business", "sponsor-renewal-roi", orgId),
    },
    {
      id: "impact",
      label: "Open Community Impact",
      detail: "Impact mentions strengthen matching-gift request letters.",
      href: hubHref("/business", "impact", orgId),
    },
  ];
}
