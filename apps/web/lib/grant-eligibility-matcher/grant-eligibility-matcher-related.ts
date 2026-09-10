import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Grant Eligibility Matcher (never DEMO grant dollars). */
export const GRANT_ELIGIBILITY_MATCHER_RELATED_LINKS = [
  { id: "grants", label: "Business · Grants", kind: "business" as const, tab: "grants" },
  { id: "grant-report", label: "Grant Report", kind: "business" as const, tab: "grant-report" },
  { id: "impact", label: "Community Impact", kind: "business" as const, tab: "impact" },
  { id: "writer", label: "Writer", kind: "ai" as const, tab: "writer" },
] as const;

export type GrantEligibilityMatcherRelatedId =
  (typeof GRANT_ELIGIBILITY_MATCHER_RELATED_LINKS)[number]["id"];

export type GrantEligibilityMatcherRelatedLink = {
  id: GrantEligibilityMatcherRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Grants / Grant Report / Impact. */
export const GRANT_ELIGIBILITY_MATCHER_RELATED_INCLUDE: GrantEligibilityMatcherRelatedId[] = [
  "grants",
  "grant-report",
  "impact",
];

/**
 * Soft-UI cross-links from Grant Eligibility Matcher → Grants / Report / Impact.
 * Build with hubHref — never broken JSX href templates.
 */
export function grantEligibilityMatcherRelatedLinks(
  orgId?: string | null,
  options?: {
    active?: GrantEligibilityMatcherRelatedId;
    include?: GrantEligibilityMatcherRelatedId[];
  },
): GrantEligibilityMatcherRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return GRANT_ELIGIBILITY_MATCHER_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "ai") {
      return { id: link.id, label: link.label, href: hubHref("/ai", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: hubHref("/business", link.tab, orgId) };
  });
}

export type GrantEligibilityMatcherShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type GrantEligibilityMatcherNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type GrantEligibilityMatcherEmptyCopy = {
  kind: GrantEligibilityMatcherShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type GrantEligibilityMatcherSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function grantEligibilityMatcherSetupSteps(
  orgId?: string | null,
): GrantEligibilityMatcherSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open eligibility matches.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "grants",
      label: "Open Grants",
      detail: "Complete team profile fields used for matching.",
      href: hubHref("/business", "grants", orgId),
    },
    {
      id: "grant-report",
      label: "Open Grant Report",
      detail: "Post-award compliance stays separate from eligibility matching.",
      href: hubHref("/business", "grant-report", orgId),
    },
    {
      id: "impact",
      label: "Open Community Impact",
      detail: "Demographics and impact narratives improve match accuracy.",
      href: hubHref("/business", "impact", orgId),
    },
  ];
}

/** Real eligible / catalog counts only — never invent DEMO totals. */
export function formatGrantEligibilityMatcherMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when nothing matches — avoids DEMO counters. */
export function shouldShowGrantEligibilityMatcherSummaryTiles(
  eligibleCount: number,
  catalogSize: number,
): boolean {
  return eligibleCount > 0 || catalogSize > 0;
}

/** Classify Grant Eligibility Matcher Soft-UI shell — never invents DEMO grant dollars. */
export function classifyGrantEligibilityMatcherShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  eligibleCount?: number;
  catalogSize?: number;
}): GrantEligibilityMatcherShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.eligibleCount ?? 0) === 0 && (input.catalogSize ?? 0) === 0) return "empty";
  if ((input.eligibleCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO grant dollars. */
export function grantEligibilityMatcherShellCopy(
  kind: GrantEligibilityMatcherShellKind,
): GrantEligibilityMatcherEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Grant Eligibility Matcher…",
        description: "Checking which team you are on and team profile.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Grant Eligibility Matcher",
        description:
          "A network or server issue blocked matching. Retry, or open Grants while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Choose your team",
        description:
          "Choose your team and complete your team profile.",
      };
    case "empty":
      return {
        kind,
        badge: "No matches yet",
        title: "No grants match your recorded team profile",
        description:
          "Complete rookie year, region, mentor employers, and demographics to surface grants you qualify for.",
      };
    default:
      return {
        kind: "ready",
        title: "Grants your team qualifies for",
        description:
          "Matches use your recorded profile only.",
      };
  }
}

/**
 * Soft-UI next actions for Grant Eligibility Matcher empty/setup shells.
 * Points at Grants / Report / Impact — never invents DEMO grant dollars.
 */
export function grantEligibilityMatcherNextActions(input: {
  orgId?: string | null;
  shell: GrantEligibilityMatcherShellKind;
  eligibleCount?: number;
  deadlineCount?: number;
}): GrantEligibilityMatcherNextAction[] {
  const orgId = input.orgId ?? null;
  const eligibleCount = input.eligibleCount ?? 0;
  const deadlineCount = input.deadlineCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team before matching grants.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "grants",
          label: "Open Grants",
          detail: "Grants stay blank until your team profile is complete.",
          href: hubHref("/business", "grants", null),
        },
        {
          id: "impact",
          label: "Open Community Impact",
          detail: "Impact narratives improve demographic matches.",
          href: hubHref("/business", "impact", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so eligibility matching can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "grants",
        label: "Open Grants",
        detail: "Complete team profile fields used for matching.",
        href: hubHref("/business", "grants", orgId),
      },
      {
        id: "grant-report",
        label: "Open Grant Report",
        detail: "Post-award compliance stays separate from eligibility.",
        href: hubHref("/business", "grant-report", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Grant Eligibility Matcher",
        detail: "Reload real eligibility matches.",
        href: withOrgHref("/grant-eligibility-matcher", orgId),
        primary: true,
      },
      {
        id: "grants",
        label: "Open Grants",
        detail: "Grants stay available while matching reloads.",
        href: hubHref("/business", "grants", orgId),
      },
      {
        id: "grant-report",
        label: "Open Grant Report",
        detail: "Grant Report stays available while matching reloads.",
        href: hubHref("/business", "grant-report", orgId),
      },
    ];
  }

  if (input.shell === "empty" || eligibleCount === 0) {
    return [
      {
        id: "profile",
        label: "Complete team profile",
        detail: "Matches stay blank until profile fields exist.",
        href: "#grant-eligibility-profile",
        primary: true,
      },
      {
        id: "grants",
        label: "Open Grants",
        detail: "Review grant workbench fields used for matching.",
        href: hubHref("/business", "grants", orgId),
      },
      {
        id: "impact",
        label: "Open Community Impact",
        detail: "Demographics narratives improve eligibility coverage.",
        href: hubHref("/business", "impact", orgId),
      },
    ];
  }

  return [
    {
      id: deadlineCount > 0 ? "deadline-radar" : "review-eligible",
      label: deadlineCount > 0 ? "Review upcoming deadlines" : "Review eligible grants",
      detail:
        deadlineCount > 0
          ? `${deadlineCount} eligible grant${deadlineCount === 1 ? "" : "s"} closing soon.`
          : `${eligibleCount} grant${eligibleCount === 1 ? "" : "s"} match your recorded profile.`,
      href: deadlineCount > 0 ? "#grant-eligibility-deadlines" : "#grant-eligibility-list",
      primary: true,
    },
    {
      id: "grant-report",
      label: "Open Grant Report",
      detail: "Track post-award compliance once awards land.",
      href: hubHref("/business", "grant-report", orgId),
    },
    {
      id: "writer",
      label: "Open Writer",
      detail: "Draft applications from real team evidence only.",
      href: hubHref("/ai", "writer", orgId),
    },
    {
      id: "impact",
      label: "Open Community Impact",
      detail: "Keep impact evidence current for funder narratives.",
      href: hubHref("/business", "impact", orgId),
    },
  ];
}
