import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Onboarding Buddy (never DEMO progress). */
export const ONBOARDING_BUDDY_RELATED_LINKS = [
  { id: "workspace", label: "Workspace", kind: "path" as const, path: "/workspace" },
  { id: "onboarding", label: "Onboarding", kind: "path" as const, path: "/onboarding" },
  { id: "team-data", label: "Team Data", kind: "path" as const, path: "/team/data" },
  { id: "team", label: "Team hub", kind: "team" as const, tab: "onboarding-buddy" },
] as const;

export type OnboardingBuddyRelatedId = (typeof ONBOARDING_BUDDY_RELATED_LINKS)[number]["id"];

export type OnboardingBuddyRelatedLink = {
  id: OnboardingBuddyRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Workspace · Onboarding · Team Data. */
export const ONBOARDING_BUDDY_RELATED_INCLUDE: OnboardingBuddyRelatedId[] = [
  "workspace",
  "onboarding",
  "team-data",
];

/**
 * Soft-UI cross-links from Onboarding Buddy → Workspace / Onboarding / Team Data.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function onboardingBuddyRelatedLinks(
  orgId?: string | null,
  options?: { active?: OnboardingBuddyRelatedId; include?: OnboardingBuddyRelatedId[] },
): OnboardingBuddyRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return ONBOARDING_BUDDY_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "team") {
      return { id: link.id, label: link.label, href: hubHref("/team", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type OnboardingBuddyShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type OnboardingBuddyNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type OnboardingBuddyEmptyCopy = {
  kind: OnboardingBuddyShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO progress. */
export type OnboardingBuddySetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function onboardingBuddySetupSteps(orgId?: string | null): OnboardingBuddySetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — buddy pairings are org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "onboarding",
      label: "Finish Onboarding",
      detail: "Complete your profile path before pairing new members.",
      href: withOrgHref("/onboarding", orgId),
    },
    {
      id: "team-data",
      label: "Open Team Data",
      detail: "Confirm real TBA/team context for this workspace.",
      href: withOrgHref("/team/data", orgId),
    },
    {
      id: "team",
      label: "Open Team hub",
      detail: "Membership and role tools stay blank until real members join.",
      href: hubHref("/team", "onboarding-buddy", orgId),
    },
  ];
}

/** Real pairing / member counts only — never invent DEMO totals. */
export function formatOnboardingBuddyMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Coverage from real active + unpaired pools only — never DEMO progress. */
export function formatOnboardingBuddyCoverage(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0%";
  return `${Math.round(Math.min(1, n) * 100)}%`;
}

/** Hide zeroed gate tiles when nothing real is on the board. */
export function shouldShowOnboardingBuddySummaryTiles(input: {
  memberCount: number;
  pairingCount: number;
  unpairedCount: number;
}): boolean {
  return input.memberCount > 0 && (input.pairingCount > 0 || input.unpairedCount > 0);
}

/** True when the workspace has no buddy pairings yet — Soft-UI empty. */
export function isOnboardingBuddyBoardEmpty(input: { pairingCount: number }): boolean {
  return input.pairingCount === 0;
}

/** Classify Onboarding Buddy Soft-UI shell — never invents DEMO progress. */
export function classifyOnboardingBuddyShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  pairingCount?: number;
}): OnboardingBuddyShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if (isOnboardingBuddyBoardEmpty({ pairingCount: input.pairingCount ?? 0 })) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO progress. */
export function onboardingBuddyShellCopy(kind: OnboardingBuddyShellKind): OnboardingBuddyEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Onboarding Buddy…",
        description:
          "Checking workspace membership and real buddy pairings.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Onboarding Buddy",
        description:
          "A network or server issue blocked buddy pairings. Retry, or open Workspace / Onboarding / Team Data while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Buddy pairing is org-scoped. Join or pick a workspace before pairing members — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No pairings yet",
        title: "Pair your first buddy",
        description:
          "First-week plans stay blank until you pair a real new member with a tenured buddy. Cross-check Workspace, Onboarding, and Team Data.",
      };
    default:
      return {
        kind: "ready",
        title: "Buddy pairings",
        description:
          "Your team's members and the pairings you logged appear here.",
      };
  }
}

/**
 * Soft-UI next actions for Onboarding Buddy empty/setup shells.
 * Points at Workspace / Onboarding / Team Data — never invents DEMO progress.
 */
export function onboardingBuddyNextActions(input: {
  orgId?: string | null;
  shell: OnboardingBuddyShellKind;
  unpairedCount?: number;
  pairingCount?: number;
  memberCount?: number;
}): OnboardingBuddyNextAction[] {
  const orgId = input.orgId ?? null;
  const unpairedCount = input.unpairedCount ?? 0;
  const pairingCount = input.pairingCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Buddy pairing is org-scoped — pick a team before suggesting buddies.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "onboarding",
          label: "Open Onboarding",
          detail: "Finish your profile path — progress stays blank until you complete real steps.",
          href: withOrgHref("/onboarding", null),
        },
        {
          id: "team-data",
          label: "Open Team Data",
          detail: "Team context stays empty until a workspace and TBA sync exist.",
          href: withOrgHref("/team/data", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Finish membership setup so Onboarding Buddy can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "onboarding",
        label: "Open Onboarding",
        detail: "Confirm your profile path before pairing new members.",
        href: withOrgHref("/onboarding", orgId),
      },
      {
        id: "team-data",
        label: "Open Team Data",
        detail: "Confirm real team/event context for this workspace.",
        href: withOrgHref("/team/data", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Onboarding Buddy",
        detail: "Reload real memberships and pairings — nothing is pre-seeded while this fails.",
        href: withOrgHref("/onboarding-buddy", orgId),
        primary: true,
      },
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Confirm the active team if membership looks wrong.",
        href: withOrgHref("/workspace", orgId),
      },
      {
        id: "onboarding",
        label: "Open Onboarding",
        detail: "Profile setup stays separate from buddy pairings.",
        href: withOrgHref("/onboarding", orgId),
      },
      {
        id: "team-data",
        label: "Open Team Data",
        detail: "TBA/team inventory stays honest when this surface is down.",
        href: withOrgHref("/team/data", orgId),
      },
    ];
  }

  if (input.shell === "empty" || pairingCount === 0) {
    return [
      {
        id: "pair",
        label: unpairedCount > 0 ? "Pair a new member" : "Wait for a new member",
        detail:
          unpairedCount > 0
            ? `${unpairedCount} recent joiner${unpairedCount === 1 ? "" : "s"} need a buddy — pair from the list below.`
            : "Pairings stay blank until a real recent joiner appears.",
        href: unpairedCount > 0 ? "#onboarding-buddy-unpaired" : withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "onboarding",
        label: "Open Onboarding",
        detail: "New members finish profile onboarding separately from buddy plans.",
        href: withOrgHref("/onboarding", orgId),
      },
      {
        id: "team-data",
        label: "Open Team Data",
        detail: "Team context for this workspace.",
        href: withOrgHref("/team/data", orgId),
      },
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Invite or switch teams if membership for this org looks incomplete.",
        href: withOrgHref("/workspace", orgId),
      },
    ];
  }

  return [
    {
      id: "unpaired",
      label: unpairedCount > 0 ? "Review unpaired members" : "All recent joiners paired",
      detail:
        unpairedCount > 0
          ? `${unpairedCount} still need a buddy — suggestions use real tenure only.`
          : "Coverage uses active pairings plus unpaired recent joiners.",
      href: "#onboarding-buddy-unpaired",
      primary: true,
    },
    {
      id: "onboarding",
      label: "Open Onboarding",
      detail: "Profile path for each member stays independent of first-week buddy plans.",
      href: withOrgHref("/onboarding", orgId),
    },
    {
      id: "team-data",
      label: "Open Team Data",
      detail: "Cross-check TBA/team context while onboarding new members.",
      href: withOrgHref("/team/data", orgId),
    },
    {
      id: "workspace",
      label: "Open Workspace",
      detail: "Switch or confirm the active organization for these pairings.",
      href: withOrgHref("/workspace", orgId),
    },
  ];
}
