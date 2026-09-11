import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Team admin membership (never DEMO members). */
export const TEAM_ADMIN_RELATED_LINKS = [
  { id: "account", label: "Account", kind: "account" as const, path: "/account?tab=profile" },
  { id: "discord", label: "Discord", kind: "path" as const, path: "/team/discord" },
  {
    id: "connections",
    label: "Account Connections",
    kind: "account" as const,
    path: "/connectors",
  },
  { id: "security", label: "Security & delegation", kind: "path" as const, path: "/team/security" },
  { id: "admin", label: "Team admin", kind: "path" as const, path: "/team/admin" },
] as const;

export type TeamAdminRelatedId = (typeof TEAM_ADMIN_RELATED_LINKS)[number]["id"];

export type TeamAdminRelatedLink = {
  id: TeamAdminRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Account · Discord · Connections. */
export const TEAM_ADMIN_RELATED_INCLUDE: TeamAdminRelatedId[] = [
  "account",
  "discord",
  "connections",
];

/**
 * Soft-UI cross-links from Team admin → Account / Discord / Connections.
 * Build with withOrgHref (and account tabs) — never broken JSX href templates.
 */
export function teamAdminRelatedLinks(
  orgId?: string | null,
  options?: { active?: TeamAdminRelatedId; include?: TeamAdminRelatedId[] },
): TeamAdminRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return TEAM_ADMIN_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "account") {
      return { id: link.id, label: link.label, href: link.path };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type TeamAdminShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type TeamAdminNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type TeamAdminEmptyCopy = {
  kind: TeamAdminShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — withOrgHref only; never DEMO members. */
export type TeamAdminSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

function teamAdminRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    teamAdminRelatedLinks(orgId, { include: [...TEAM_ADMIN_RELATED_INCLUDE] }).map((link) => link.href),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = teamAdminRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

/** Empty-card primary on the no-org / setup shells. */
export function teamAdminCardPrimaryHref(orgId?: string | null): string {
  return orgId ? withOrgHref("/workspace", orgId) : "/workspace";
}

export function teamAdminSetupSteps(orgId?: string | null): TeamAdminSetupStep[] {
  const steps: TeamAdminSetupStep[] = [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open membership and invites.",
      href: teamAdminCardPrimaryHref(orgId),
    },
  ];
  if (orgId) {
    steps.push({
      id: "invite",
      label: "Invite an exact email",
      detail: "Team numbers never grant access — send a real invite; the ledger stays blank until then.",
      href: withOrgHref("/team/admin", orgId) + "#membership",
    });
  }
  steps.push(
    {
      id: "discord",
      label: "Link Discord",
      detail: "Guild / webhook bridge stays empty until configured.",
      href: withOrgHref("/team/discord", orgId),
    },
    {
      id: "connections",
      label: "Account Connections",
      detail: "Honest connector status for TBA, Onshape, Discord, and GitHub.",
      href: "/connectors",
    },
  );
  return dropRelatedStripDuplicates(orgId, steps);
}

/** Real member / invite counts only — never invent DEMO totals. */
export function formatTeamAdminMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed membership tiles when nothing real is loaded. */
export function shouldShowTeamAdminSummaryTiles(input: {
  memberCount: number;
  inviteCount: number;
}): boolean {
  return input.memberCount > 0 || input.inviteCount > 0;
}

/** True when the team has no real members — Soft-UI empty (never DEMO). */
export function isTeamAdminBoardEmpty(input: { memberCount: number }): boolean {
  return input.memberCount <= 0;
}

/** Classify Team admin membership Soft-UI shell — never invents DEMO members. */
export function classifyTeamAdminShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  hasOrgs?: boolean;
  orgId?: string | null;
  memberCount?: number;
}): TeamAdminShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.hasOrgs || !input.orgId) return "setup";
  if (isTeamAdminBoardEmpty({ memberCount: input.memberCount ?? 0 })) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO members. */
export function teamAdminShellCopy(kind: TeamAdminShellKind): TeamAdminEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading membership…",
        description:
          "Checking which team you are on and real invites.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load membership",
        description:
          "A network or server issue blocked the members ledger. Retry, or open Account / Discord / Connections while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Choose your team",
        description:
          "Choose your team before managing access.",
      };
    case "empty":
      return {
        kind,
        badge: "No members yet",
        title: "Membership stays blank until real people join",
        description:
          "The members list and invite ledger stay empty until real people join. Cross-check Account, Discord, and Connections.",
      };
    case "ready":
      return {
        kind,
        title: "Members and invites",
        description:
          "Only real membership rows and invites appear here.",
      };
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

/**
 * Soft-UI next actions for Team admin membership empty/setup shells.
 * Destinations already in the header related strip are omitted so each href
 * appears once. Never invents DEMO members.
 */
export function teamAdminNextActions(input: {
  orgId?: string | null;
  shell: TeamAdminShellKind;
  memberCount?: number;
  pendingInviteCount?: number;
  pendingAccessCount?: number;
}): TeamAdminNextAction[] {
  if (!input.orgId || input.shell === "setup") {
    return setupActionsFrom(teamAdminSetupSteps(input.orgId));
  }
  return dropRelatedStripDuplicates(input.orgId, teamAdminNextActionCandidates(input));
}

function teamAdminNextActionCandidates(input: {
  orgId?: string | null;
  shell: TeamAdminShellKind;
  memberCount?: number;
  pendingInviteCount?: number;
  pendingAccessCount?: number;
}): TeamAdminNextAction[] {
  const orgId = input.orgId ?? null;
  const pendingInvites = input.pendingInviteCount ?? 0;
  const pendingAccess = input.pendingAccessCount ?? 0;

  if (input.shell === "empty") {
    return [
      {
        id: "invite",
        label: "Invite an exact email",
        detail: "Team numbers never grant access — send a real invite.",
        href: "#invite-form",
        primary: true,
      },
      {
        id: "account",
        label: "Account profile",
        detail: "Confirm the admin identity that will send invites.",
        href: "/account?tab=profile",
      },
      {
        id: "discord",
        label: "Open Discord",
        detail: "Announce access policy in a linked channel after membership exists.",
        href: withOrgHref("/team/discord", orgId),
      },
      {
        id: "connections",
        label: "Account Connections",
        detail: "Team connectors stay honest until linked.",
        href: "/connectors",
      },
    ];
  }

  if (pendingAccess > 0) {
    return [
      {
        id: "access",
        label: `Review ${pendingAccess} access request${pendingAccess === 1 ? "" : "s"}`,
        detail: "Verified applicants wait here — approval ends onboarding sessions and emails a fresh sign-in link.",
        href: "#team-access-title",
        primary: true,
      },
      {
        id: "invite",
        label: "Invite another email",
        detail: "Exact-email invites still work alongside access requests.",
        href: "#membership",
      },
      {
        id: "discord",
        label: "Open Discord",
        detail: "Optional guild announcements after you approve real members.",
        href: withOrgHref("/team/discord", orgId),
      },
      {
        id: "connections",
        label: "Account Connections",
        detail: "Confirm connectors for the team these members will use.",
        href: "/connectors",
      },
    ];
  }

  if (pendingInvites > 0) {
    return [
      {
        id: "ledger",
        label: "Review pending invites",
        detail: `${pendingInvites} real invitation${pendingInvites === 1 ? "" : "s"} in the ledger — resend or revoke.`,
        href: "#invitation-ledger",
        primary: true,
      },
      {
        id: "account",
        label: "Account profile",
        detail: "Notification prefs control invite-related emails for this login.",
        href: "/account?tab=profile",
      },
      {
        id: "discord",
        label: "Open Discord",
        detail: "Bridge stays blank until a webhook or bot is configured.",
        href: withOrgHref("/team/discord", orgId),
      },
      {
        id: "connections",
        label: "Account Connections",
        detail: "Honest TBA / Onshape / Discord / GitHub status for this team.",
        href: "/connectors",
      },
    ];
  }

  return [
    {
      id: "invite",
      label: "Invite another teammate",
      detail: "Exact emails only — the ledger grows from real sends.",
      href: "#membership",
      primary: true,
    },
    {
      id: "security",
      label: "Security & delegation",
      detail: "Delegate manage_members or other capabilities without inventing roles.",
      href: withOrgHref("/team/security", orgId),
    },
    {
      id: "discord",
      label: "Open Discord",
      detail: "Guild / chat bridge for announcements after membership is set.",
      href: withOrgHref("/team/discord", orgId),
    },
    {
      id: "connections",
      label: "Account Connections",
      detail: "Team connectors stay Connected only from real rows.",
      href: "/connectors",
    },
    {
      id: "account",
      label: "Account profile",
      detail: "Personal prefs for the admin managing this roster.",
      href: "/account?tab=profile",
    },
  ];
}
