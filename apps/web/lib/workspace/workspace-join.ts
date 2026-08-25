import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for `/workspace` join / select. */
export const WORKSPACE_RELATED_LINKS = [
  { id: "invite", label: "Accept invite", kind: "personal" as const, path: "/invite" },
  { id: "support", label: "Support", kind: "personal" as const, path: "/support" },
  { id: "account", label: "Account", kind: "personal" as const, path: "/account?tab=profile" },
] as const;

export type WorkspaceRelatedId = (typeof WORKSPACE_RELATED_LINKS)[number]["id"];

export type WorkspaceRelatedLink = {
  id: WorkspaceRelatedId;
  label: string;
  href: string;
};

export const WORKSPACE_RELATED_INCLUDE: WorkspaceRelatedId[] = ["invite", "support", "account"];

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
    if (link.id === "invite") return { id: link.id, label: link.label, href: link.path };
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

export function workspaceOrgHref(orgId?: string | null): string {
  if (!orgId) return "/workspace";
  return withOrgHref("/workspace", orgId);
}

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

/** Brief Soft-UI copy — closed membership, no lecture. */
export function workspaceShellCopy(kind: WorkspaceShellKind): WorkspaceJoinCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        eyebrow: "WORKSPACE",
        title: "Loading…",
        description: "Checking your team memberships.",
      };
    case "setup":
      return {
        kind,
        eyebrow: "SETUP",
        title: "Finish setup",
        description: "Complete your profile before joining a team.",
        badge: "Setup",
      };
    case "select":
      return {
        kind,
        eyebrow: "TEAMS",
        title: "Choose a team",
        description: "You belong to more than one workspace.",
        badge: "Multiple teams",
      };
    case "ready":
      return {
        kind,
        eyebrow: "WORKSPACE",
        title: "Continue",
        description: "Open your team workspace.",
      };
    default:
      return {
        kind: "empty",
        eyebrow: "JOIN",
        title: "No team yet",
        description: "Claim your FRC team number, or open an invite sent to your login email.",
        badge: "Claim or invite",
      };
  }
}

/** @deprecated Prefer workspaceShellCopy */
export function workspaceJoinCopy(kind: Exclude<WorkspaceJoinKind, "loading" | "ready">): WorkspaceJoinCopy {
  if (kind === "select") return workspaceShellCopy("select");
  return workspaceShellCopy("empty");
}

/**
 * Single short path for empty join — no Onboarding Buddy until membership exists.
 * Prefer this over duplicated Setup + Next steps lists.
 */
export function workspaceSetupSteps(_orgId?: string | null): WorkspaceSetupStep[] {
  return [
    {
      id: "invite",
      label: "Open invite from email",
      detail: "Use the full link sent to your login address.",
      href: "/invite",
    },
    {
      id: "claim",
      label: "Claim FRC team",
      detail: "Create a workspace for an unused TBA team number.",
      href: "/claim",
    },
  ];
}

/** Deduped next actions — one primary CTA; support only as secondary quiet link. */
export function workspaceJoinNextActions(
  kind: Exclude<WorkspaceJoinKind, "loading" | "ready"> | WorkspaceShellKind,
  _orgId?: string | null,
): WorkspaceJoinNextAction[] {
  const shell: WorkspaceShellKind =
    kind === "none" ? "empty" : kind === "select" ? "select" : (kind as WorkspaceShellKind);

  if (shell === "select") {
    return [
      {
        id: "invite",
        label: "Accept another invite",
        detail: "Join an additional team with an email invite.",
        href: "/invite",
      },
    ];
  }

  return [
    {
      id: "invite",
      label: "Open invite from email",
      detail: "Use the full invitation link.",
      href: "/invite",
      primary: true,
    },
    {
      id: "claim",
      label: "Claim your FRC team",
      detail: "Verified accounts can create one workspace per unused TBA team number.",
      href: "/claim",
    },
  ];
}
