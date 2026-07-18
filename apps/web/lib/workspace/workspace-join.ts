import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for `/workspace` join / select (never DEMO orgs). */
export const WORKSPACE_RELATED_LINKS = [
  /** Personal invite accept — leave org-free (token in query, not orgId). */
  { id: "invite", label: "Accept invite", kind: "personal" as const, path: "/invite" },
  { id: "support", label: "Help & Support", kind: "personal" as const, path: "/support" },
  {
    id: "account",
    label: "Account",
    kind: "personal" as const,
    path: "/account?tab=profile",
  },
  {
    id: "onboarding-buddy",
    label: "Onboarding Buddy",
    kind: "team" as const,
    tab: "onboarding-buddy",
  },
] as const;

export type WorkspaceRelatedId = (typeof WORKSPACE_RELATED_LINKS)[number]["id"];

export type WorkspaceRelatedLink = {
  id: WorkspaceRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Invite · Support · Account. */
export const WORKSPACE_RELATED_INCLUDE: WorkspaceRelatedId[] = [
  "invite",
  "support",
  "account",
];

/**
 * Soft-UI cross-links from Workspace join/select → Invite / Support / Account.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function workspaceRelatedLinks(
  orgId?: string | null,
  options?: { active?: WorkspaceRelatedId; include?: WorkspaceRelatedId[] },
): WorkspaceRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return WORKSPACE_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "team") {
      return { id: link.id, label: link.label, href: hubHref("/team", link.tab, orgId) };
    }
    // Invite stays token-scoped (not orgId). Support / Account are ORG_EXEMPT via withOrgHref.
    if (link.id === "invite") {
      return { id: link.id, label: link.label, href: link.path };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type WorkspaceJoinKind = "loading" | "none" | "select" | "ready";

export type WorkspaceShellKind = "loading" | "setup" | "empty" | "select" | "ready";

export type WorkspaceJoinCopy = {
  kind: WorkspaceShellKind;
  eyebrow: string;
  title: string;
  description: string;
  badge?: string;
};

export type WorkspaceMembershipOption = {
  orgId: string;
  orgName: string;
  teamNumber: number | null;
};

export type WorkspaceJoinNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type WorkspaceSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

/** Org-scoped workspace deep link — never a DEMO seed path. */
export function workspaceOrgHref(orgId?: string | null): string {
  if (!orgId) return "/workspace";
  return withOrgHref("/workspace", orgId);
}

/**
 * Keep only real membership rows with a non-empty org id.
 * Never invents DEMO organizations when the list is empty.
 */
export function realWorkspaceMemberships(
  rows: Array<{ orgId?: string | null; orgName?: string | null; teamNumber?: number | null }>,
): WorkspaceMembershipOption[] {
  const out: WorkspaceMembershipOption[] = [];
  for (const row of rows) {
    const orgId = row.orgId?.trim();
    if (!orgId) continue;
    out.push({
      orgId,
      orgName: row.orgName?.trim() || "",
      teamNumber:
        row.teamNumber != null && Number.isFinite(row.teamNumber) ? Number(row.teamNumber) : null,
    });
  }
  return out;
}

/** Real membership count only — never invent DEMO totals. */
export function formatWorkspaceMembershipCount(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

export function formatWorkspaceOrgLabel(input: {
  orgName: string;
  teamNumber: number | null;
}): string {
  const team =
    input.teamNumber != null && Number.isFinite(input.teamNumber) ? `Team ${input.teamNumber}` : null;
  const name = input.orgName?.trim() || null;
  const parts = [team, name].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Team workspace";
}

/** Classify Workspace join Soft-UI shell — never invents DEMO orgs. */
export function classifyWorkspaceShell(input: {
  loading?: boolean;
  membershipCount?: number;
}): WorkspaceShellKind {
  if (input.loading) return "loading";
  const count = input.membershipCount ?? 0;
  if (count <= 0) return "empty";
  if (count === 1) return "ready";
  return "select";
}

/** Soft-UI empty / setup / select copy — never DEMO organizations. */
export function workspaceShellCopy(kind: WorkspaceShellKind): WorkspaceJoinCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        eyebrow: "WORKSPACE",
        title: "Loading memberships…",
        description:
          "Checking real organization memberships for this login — never DEMO organizations.",
      };
    case "setup":
      return {
        kind,
        eyebrow: "SETUP REQUIRED",
        title: "Finish workspace setup",
        description:
          "Membership is closed and invite-based. Complete profile or access setup before a team can appear here — nothing is pre-seeded.",
        badge: "Setup required",
      };
    case "select":
      return {
        kind,
        eyebrow: "CHOOSE WORKSPACE",
        title: "Select your team workspace",
        description:
          "You belong to more than one real organization. Pick one to continue — no DEMO organizations appear here.",
        badge: "Multiple teams",
      };
    case "ready":
      return {
        kind,
        eyebrow: "WORKSPACE",
        title: "Continue to your team",
        description: "Only real memberships appear here — never DEMO organizations.",
      };
    default:
      return {
        kind: "empty",
        eyebrow: "JOIN A TEAM",
        title: "Join a team workspace",
        description:
          "Access comes from a verified invitation to your exact email. Team numbers never open a workspace, and this list stays blank until a real membership exists — never DEMO organizations.",
        badge: "No memberships",
      };
  }
}

/** @deprecated Prefer workspaceShellCopy — kept for existing call sites. */
export function workspaceJoinCopy(kind: Exclude<WorkspaceJoinKind, "loading" | "ready">): WorkspaceJoinCopy {
  if (kind === "select") return workspaceShellCopy("select");
  return workspaceShellCopy("empty");
}

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO orgs. */
export function workspaceSetupSteps(orgId?: string | null): WorkspaceSetupStep[] {
  return [
    {
      id: "invite",
      label: "Open invite from email",
      detail: "Use the full invitation link — exact-email match required.",
      // Invite accept is token-scoped; keep personal (no orgId) like Account.
      href: "/invite",
    },
    {
      id: "account",
      label: "Confirm Account email",
      detail: "Invites bind to your verified login address — check Account before accepting.",
      href: withOrgHref("/account?tab=profile", orgId),
    },
    {
      id: "support",
      label: "Help & Support",
      detail: "Ask for a fresh invite if you expected a membership and do not see a workspace.",
      href: withOrgHref("/support", orgId),
    },
    {
      id: "onboarding-buddy",
      label: "Onboarding Buddy",
      detail: "Role / subteam Soft-UI path after you have a real membership — never DEMO orgs.",
      href: hubHref("/team", "onboarding-buddy", orgId),
    },
  ];
}

/**
 * Soft-UI next actions for Workspace join / select shells.
 * Points at Invite / Support / Account — never invents DEMO organizations.
 */
export function workspaceJoinNextActions(
  kind: Exclude<WorkspaceJoinKind, "loading" | "ready"> | WorkspaceShellKind,
  orgId?: string | null,
): WorkspaceJoinNextAction[] {
  const shell: WorkspaceShellKind =
    kind === "none" ? "empty" : kind === "select" ? "select" : (kind as WorkspaceShellKind);

  if (shell === "select") {
    return [
      {
        id: "account",
        label: "Account",
        detail: "Confirm which verified email is signed in before accepting another invite.",
        href: withOrgHref("/account?tab=profile", orgId),
        primary: true,
      },
      {
        id: "invite",
        label: "Accept another invite",
        detail: "Join an additional real team with an exact-email invitation — never DEMO orgs.",
        href: "/invite",
      },
      {
        id: "support",
        label: "Help & Support",
        detail: "Ask for access help if a membership you expected is missing from this list.",
        href: withOrgHref("/support", orgId),
      },
    ];
  }

  // empty / setup / none — closed membership, invite-first
  return [
    {
      id: "invite",
      label: "Open invite from email",
      detail: "Use the full invitation link sent to your verified address — exact-email match required.",
      href: "/invite",
      primary: true,
    },
    {
      id: "account",
      label: "Account",
      detail: "Confirm your verified email before accepting — invites never invent DEMO organizations.",
      href: withOrgHref("/account?tab=profile", orgId),
    },
    {
      id: "support",
      label: "Help & Support",
      detail: "Ask for a fresh invite if you expected membership and do not see a workspace.",
      href: withOrgHref("/support", orgId),
    },
    {
      id: "onboarding-buddy",
      label: "Onboarding Buddy",
      detail: "Available after a real membership exists — the Team hub stays honest until then.",
      href: hubHref("/team", "onboarding-buddy", orgId),
    },
  ];
}
