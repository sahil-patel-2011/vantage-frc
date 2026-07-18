/** Soft-UI helpers for `/workspace` join / select — closed membership, no DEMO orgs. */

export type WorkspaceJoinKind = "none" | "select" | "loading";

export type WorkspaceJoinCopy = {
  kind: WorkspaceJoinKind;
  eyebrow: string;
  title: string;
  description: string;
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

export function workspaceJoinCopy(kind: Exclude<WorkspaceJoinKind, "loading">): WorkspaceJoinCopy {
  if (kind === "select") {
    return {
      kind,
      eyebrow: "CHOOSE WORKSPACE",
      title: "Select your team workspace",
      description: "You belong to more than one organization. Pick one to continue — membership is closed and invite-based.",
    };
  }
  return {
    kind: "none",
    eyebrow: "JOIN A TEAM",
    title: "Join a team workspace",
    description:
      "Access comes from a verified invitation to your exact email. Team numbers never open a workspace by themselves.",
  };
}

export function workspaceJoinNextActions(kind: Exclude<WorkspaceJoinKind, "loading">): WorkspaceJoinNextAction[] {
  if (kind === "select") {
    return [
      {
        id: "dashboard",
        label: "Back to dashboard",
        detail: "Return home if you are not ready to pick a workspace yet.",
        href: "/dashboard",
      },
      {
        id: "account",
        label: "Account",
        detail: "Confirm which verified email is signed in before accepting another invite.",
        href: "/account",
      },
    ];
  }
  return [
    {
      id: "invite",
      label: "Open invite from email",
      detail: "Use the full invitation link sent to your verified address — exact-email match required.",
      href: "/signin",
      primary: true,
    },
    {
      id: "onboarding",
      label: "Request access",
      detail: "Without an invite, submit an access request. An owner or admin still must approve.",
      href: "/onboarding",
    },
    {
      id: "support",
      label: "Help & Support",
      detail: "Ask for a fresh invite if you expected membership and do not see a workspace.",
      href: "/support",
    },
  ];
}
