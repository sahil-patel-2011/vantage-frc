import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Sponsor Wall (never DEMO sponsor counts). */
export const SPONSOR_WALL_RELATED_LINKS = [
  { id: "sponsors", label: "Sponsor CRM", kind: "business" as const, tab: "sponsors" },
  { id: "sponsorship", label: "Sponsorship", kind: "business" as const, tab: "sponsorship" },
  { id: "sponsor-suite", label: "Sponsor Suite", kind: "business" as const, tab: "sponsor-suite" },
  { id: "placements", label: "Partner packages", kind: "business" as const, tab: "placements" },
] as const;

export type SponsorWallRelatedId = (typeof SPONSOR_WALL_RELATED_LINKS)[number]["id"];

export type SponsorWallRelatedLink = {
  id: SponsorWallRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Sponsor CRM / Sponsorship / Sponsor Suite. */
export const SPONSOR_WALL_RELATED_INCLUDE: SponsorWallRelatedId[] = [
  "sponsors",
  "sponsorship",
  "sponsor-suite",
];

/**
 * Soft-UI cross-links from Sponsor Wall → CRM / Sponsorship / Suite.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function sponsorWallRelatedLinks(
  orgId?: string | null,
  options?: { active?: SponsorWallRelatedId; include?: SponsorWallRelatedId[] },
): SponsorWallRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return SPONSOR_WALL_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/business", link.tab, orgId),
  }));
}

export type SponsorWallShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type SponsorWallNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type SponsorWallEmptyCopy = {
  kind: SponsorWallShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO sponsor counts. */
export type SponsorWallSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function sponsorWallSetupSteps(orgId?: string | null): SponsorWallSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — sponsor walls are org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "sponsors",
      label: "Open Sponsor CRM",
      detail: "Sponsor rows stay blank until your team logs them — nothing is pre-seeded.",
      href: hubHref("/business", "sponsors", orgId),
    },
    {
      id: "sponsorship",
      label: "Open Sponsorship",
      detail: "One-pagers stay empty until real packages exist — nothing is pre-seeded.",
      href: hubHref("/business", "sponsorship", orgId),
    },
    {
      id: "sponsor-suite",
      label: "Open Sponsor Suite",
      detail: "Suite assets stay blank until real sponsors land — nothing is pre-seeded.",
      href: hubHref("/business", "sponsor-suite", orgId),
    },
  ];
}

/** Real wall entry counts only — never invent DEMO totals. */
export function formatSponsorWallMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when nothing is on the wall — avoids DEMO counters. */
export function shouldShowSponsorWallSummaryTiles(entryCount: number): boolean {
  return entryCount > 0;
}

/** True when the workspace has no wall entries yet — Soft-UI empty. */
export function isSponsorWallBoardEmpty(input: { entryCount: number }): boolean {
  return input.entryCount === 0;
}

/** Classify Sponsor Wall Soft-UI shell — never invents DEMO sponsor counts. */
export function classifySponsorWallShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  entryCount?: number;
}): SponsorWallShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if (isSponsorWallBoardEmpty({ entryCount: input.entryCount ?? 0 })) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO sponsor counts. */
export function sponsorWallShellCopy(kind: SponsorWallShellKind): SponsorWallEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Sponsor Wall…",
        description:
          "Checking workspace membership and wall entries — never DEMO sponsor counts.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load the Sponsor Wall",
        description:
          "A network or server issue blocked the wall. Retry, or open Sponsor CRM / Sponsorship while it reloads — never invent DEMO sponsor counts.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Sponsor Wall is org-scoped. Pick a workspace and add real sponsors before publishing — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No sponsors yet",
        title: "Add your first sponsor to build the wall",
        description:
          "Logos, tiers, and thank-you messages stay blank until you add real entries. Cross-check Sponsor CRM and Sponsorship — never DEMO sponsor counts.",
      };
    default:
      return {
        kind: "ready",
        title: "Public thank-you wall",
        description:
          "Published entries reflect sponsors you add — never DEMO logos or invent shout-outs.",
      };
  }
}

/**
 * Soft-UI next actions for Sponsor Wall empty/setup shells.
 * Points at Sponsor CRM / Sponsorship — never invents DEMO sponsor counts.
 */
export function sponsorWallNextActions(input: {
  orgId?: string | null;
  shell: SponsorWallShellKind;
  entryCount?: number;
  publishedCount?: number;
}): SponsorWallNextAction[] {
  const orgId = input.orgId ?? null;
  const entryCount = input.entryCount ?? 0;
  const publishedCount = input.publishedCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Sponsor walls are org-scoped — pick a team before adding logos.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "sponsors",
          label: "Open Sponsor CRM",
          detail: "Sponsor rows stay blank until your team logs them — never DEMO logos.",
          href: hubHref("/business", "sponsors", null),
        },
        {
          id: "sponsorship",
          label: "Open Sponsorship",
          detail: "One-pagers stay empty until real packages exist — never invent DEMO tiers.",
          href: hubHref("/business", "sponsorship", null),
        },
        {
          id: "sponsor-suite",
          label: "Open Sponsor Suite",
          detail: "Suite assets stay blank until real sponsors land — never DEMO shout-outs.",
          href: hubHref("/business", "sponsor-suite", null),
        },
      ];
    }
    return sponsorWallSetupSteps(orgId).map((step, index) => ({
      ...step,
      primary: index === 0,
    }));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Sponsor Wall",
        detail: "Reload real wall entries — nothing is invented while this fails.",
        href: withOrgHref("/sponsor-wall", orgId),
        primary: true,
      },
      {
        id: "sponsors",
        label: "Open Sponsor CRM",
        detail: "Sponsor rows stay available while the wall reloads.",
        href: hubHref("/business", "sponsors", orgId),
      },
      {
        id: "sponsorship",
        label: "Open Sponsorship",
        detail: "Sponsorship materials stay available while the wall reloads.",
        href: hubHref("/business", "sponsorship", orgId),
      },
    ];
  }

  if (input.shell === "empty" || entryCount === 0) {
    return [
      {
        id: "add",
        label: "Add a sponsor",
        detail: "Wall entries stay blank until you add real logos — never invent DEMO shout-outs.",
        href: "#sponsor-wall-add",
        primary: true,
      },
      {
        id: "sponsors",
        label: "Open Sponsor CRM",
        detail: "Pull names from real CRM rows — never DEMO logos.",
        href: hubHref("/business", "sponsors", orgId),
      },
      {
        id: "sponsorship",
        label: "Open Sponsorship",
        detail: "Align wall tiers with real package language — never invent DEMO tiers.",
        href: hubHref("/business", "sponsorship", orgId),
      },
    ];
  }

  const actions: SponsorWallNextAction[] = [
    {
      id: "add-more",
      label: "Add another sponsor",
      detail:
        publishedCount > 0
          ? `${publishedCount} published entr${publishedCount === 1 ? "y" : "ies"} — only real logos.`
          : `${entryCount} entr${entryCount === 1 ? "y" : "ies"} on the wall — never DEMO shout-outs.`,
      href: "#sponsor-wall-add",
      primary: true,
    },
    {
      id: "sponsors",
      label: "Open Sponsor CRM",
      detail: "Keep wall names grounded in CRM sponsors — never DEMO logos.",
      href: hubHref("/business", "sponsors", orgId),
    },
    {
      id: "sponsorship",
      label: "Open Sponsorship",
      detail: "Keep tier language aligned with real packages.",
      href: hubHref("/business", "sponsorship", orgId),
    },
    {
      id: "sponsor-suite",
      label: "Open Sponsor Suite",
      detail: "Pair wall shout-outs with suite assets — never invent DEMO sponsors.",
      href: hubHref("/business", "sponsor-suite", orgId),
    },
  ];

  return actions.slice(0, 5);
}
