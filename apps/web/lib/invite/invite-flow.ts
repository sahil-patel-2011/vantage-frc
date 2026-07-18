/** Soft-UI helpers for `/invite` accept — exact-email invites, never DEMO membership. */

export const PENDING_INVITE_STORAGE_KEY = "vantage.pendingInviteToken";

export type InvitePreviewStatus =
  | "pending"
  | "accepted"
  | "expired"
  | "revoked"
  | "unknown";

export type InviteFlowKind =
  | "loading"
  | "missing_token"
  | "auth_required"
  | "email_mismatch"
  | "invalid"
  | "expired"
  | "accepted"
  | "revoked"
  | "ready"
  | "error";

export type InvitePreview = {
  orgId?: string;
  orgName: string;
  teamNumber: number;
  role: string;
  email: string;
  status: string;
  expiresAt: string;
};

export type InviteEmptyCopy = {
  kind: InviteFlowKind;
  eyebrow: string;
  title: string;
  description: string;
  badge?: string;
};

export type InviteNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/** Normalize invite status from peek_org_invite — blank-safe. */
export function normalizeInviteStatus(status: string | null | undefined): InvitePreviewStatus {
  const value = status?.trim().toLowerCase() ?? "";
  if (value === "pending") return "pending";
  if (value === "accepted") return "accepted";
  if (value === "expired") return "expired";
  if (value === "revoked") return "revoked";
  return "unknown";
}

/** Soft-UI label for invite role — blank-safe, never a DEMO title. */
export function formatInviteRole(role: string | null | undefined): string | null {
  if (!role?.trim()) return null;
  const normalized = role.trim().toLowerCase();
  if (normalized === "owner") return "Owner";
  if (normalized === "admin") return "Admin";
  if (normalized === "mentor") return "Mentor";
  if (normalized === "member") return "Member";
  if (normalized === "viewer") return "Viewer";
  return role.trim();
}

/** Clear team identity line: Team N · Org name · Role. */
export function formatInviteTeamIdentity(
  preview: Pick<InvitePreview, "orgName" | "teamNumber" | "role">,
): string {
  const team =
    preview.teamNumber != null && Number.isFinite(preview.teamNumber)
      ? `Team ${preview.teamNumber}`
      : null;
  const name = preview.orgName?.trim() || null;
  const role = formatInviteRole(preview.role);
  const parts = [team, name, role].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Team workspace";
}

/** Terms checkbox required unless this login already accepted. */
export function inviteTermsRequired(termsAcceptedAt: string | null | undefined): boolean {
  return !termsAcceptedAt?.trim();
}

export function inviteCanAccept(input: {
  termsAccepted: boolean;
  termsRequired: boolean;
  status?: string | null;
}): boolean {
  if (normalizeInviteStatus(input.status) !== "pending") return false;
  if (input.termsRequired && !input.termsAccepted) return false;
  return true;
}

/** Classify Soft-UI shell from token + preview fetch outcome. */
export function classifyInviteFlow(input: {
  token: string;
  loading: boolean;
  authRequired?: boolean;
  emailMismatch?: boolean;
  preview: InvitePreview | null | undefined;
  error?: string | null;
}): InviteFlowKind {
  if (!input.token.trim()) return "missing_token";
  if (input.authRequired) return "auth_required";
  if (input.loading) return "loading";
  if (input.emailMismatch) return "email_mismatch";
  if (input.preview) {
    const status = normalizeInviteStatus(input.preview.status);
    if (status === "pending") {
      const expiresMs = Date.parse(input.preview.expiresAt);
      if (Number.isFinite(expiresMs) && expiresMs <= Date.now()) return "expired";
      return "ready";
    }
    if (status === "expired") return "expired";
    if (status === "accepted") return "accepted";
    if (status === "revoked") return "revoked";
    return "invalid";
  }
  if (input.error?.trim()) return "error";
  return "invalid";
}

/** Soft-UI empty / setup copy — never invents a joinable team. */
export function inviteEmptyCopy(kind: InviteFlowKind, detail?: string | null): InviteEmptyCopy {
  if (kind === "loading") {
    return {
      kind,
      eyebrow: "TEAM INVITATION",
      title: "Loading invitation…",
      description:
        "Checking this invite against your verified email. Membership stays closed until accept succeeds.",
    };
  }
  if (kind === "missing_token") {
    return {
      kind,
      eyebrow: "INVITE LINK INCOMPLETE",
      title: "This invitation link is incomplete",
      description:
        detail?.trim() ||
        "Open the full link from your invite email. Vantage never opens a workspace from a team number alone.",
      badge: "Link missing",
    };
  }
  if (kind === "auth_required") {
    return {
      kind,
      eyebrow: "SIGN IN REQUIRED",
      title: "Sign in with the invited email",
      description:
        detail?.trim() ||
        "Accepting an invite requires a verified session on the exact email that received it.",
      badge: "Setup required",
    };
  }
  if (kind === "email_mismatch") {
    return {
      kind,
      eyebrow: "EMAIL DOES NOT MATCH",
      title: "This invite was sent to a different email",
      description:
        detail?.trim() ||
        "Sign out and sign in with the exact address on the invitation. Exact-email matching is intentional.",
      badge: "Exact email",
    };
  }
  if (kind === "expired") {
    return {
      kind,
      eyebrow: "INVITE EXPIRED",
      title: "This invitation has expired",
      description:
        detail?.trim() ||
        "Ask a team owner or admin to resend an invite to your verified email. Nothing was joined.",
      badge: "Expired",
    };
  }
  if (kind === "accepted") {
    return {
      kind,
      eyebrow: "ALREADY ACCEPTED",
      title: "This invitation was already used",
      description:
        detail?.trim() ||
        "If you already joined, open Workspace. Otherwise ask an owner for a fresh invite to your email.",
      badge: "Used",
    };
  }
  if (kind === "revoked") {
    return {
      kind,
      eyebrow: "INVITE REVOKED",
      title: "This invitation was revoked",
      description:
        detail?.trim() ||
        "A team leader cancelled this invite. Request a new one to your verified email if you still need access.",
      badge: "Revoked",
    };
  }
  if (kind === "error") {
    return {
      kind,
      eyebrow: "COULD NOT LOAD",
      title: "Could not load this invitation",
      description:
        detail?.trim() ||
        "A network or server issue prevented loading. Nothing was filled with DEMO membership — retry when ready.",
      badge: "Retry",
    };
  }
  return {
    kind: "invalid",
    eyebrow: "INVITE UNAVAILABLE",
    title: "This invitation is invalid or unavailable",
    description:
      detail?.trim() ||
      "The link may be wrong, already used, or revoked. Ask your coach for a new invite to your exact email.",
    badge: "Unavailable",
  };
}

/**
 * Soft-UI next actions for invite accept / empty shells.
 * Preserves closed membership — never points at a fake join-by-number path.
 */
export function inviteNextActions(input: {
  kind: InviteFlowKind;
  orgId?: string | null;
  token?: string | null;
}): InviteNextAction[] {
  const token = input.token?.trim() || "";
  const inviteReturn = token ? `/invite?token=${encodeURIComponent(token)}` : "/invite";
  const signInHref = `/signin?next=${encodeURIComponent(inviteReturn)}`;

  if (input.kind === "ready") {
    return [
      {
        id: "accept",
        label: "Accept with this verified email",
        detail: "Joining requires exact-email match. Team numbers never unlock a workspace by themselves.",
        href: "#invite-accept",
        primary: true,
      },
      {
        id: "onboarding",
        label: "Finish profile setup first",
        detail: "If onboarding is incomplete, complete it then return to this invite link.",
        href: "/onboarding",
      },
      {
        id: "support",
        label: "Help & Support",
        detail: "Open a ticket if the invite email does not match the account you expected.",
        href: "/support",
      },
    ];
  }

  if (input.kind === "auth_required" || input.kind === "email_mismatch") {
    return [
      {
        id: "signin",
        label: input.kind === "email_mismatch" ? "Sign in with the invited email" : "Sign in to continue",
        detail: "Use the exact verified address on the invitation — Google or email OTP.",
        href: signInHref,
        primary: true,
      },
      {
        id: "support",
        label: "Help & Support",
        detail: "Ask for a new invite if you no longer have access to that email.",
        href: "/support",
      },
    ];
  }

  if (input.kind === "accepted") {
    const workspaceHref = input.orgId
      ? `/workspace?orgId=${encodeURIComponent(input.orgId)}`
      : "/workspace";
    return [
      {
        id: "workspace",
        label: "Open workspace",
        detail: "If membership already exists, continue in your team workspace.",
        href: workspaceHref,
        primary: true,
      },
      {
        id: "dashboard",
        label: "Back to dashboard",
        detail: "Return to the signed-in home surface.",
        href: "/dashboard",
      },
    ];
  }

  if (input.kind === "expired" || input.kind === "revoked" || input.kind === "invalid") {
    return [
      {
        id: "support",
        label: "Ask for a new invite",
        detail:
          "Owners and admins resend exact-email invites from Team admin. Support can help if you are stuck.",
        href: "/support",
        primary: true,
      },
      {
        id: "workspace",
        label: "Check workspace access",
        detail: "If you already belong to a team, pick it from Workspace.",
        href: "/workspace",
      },
      {
        id: "onboarding",
        label: "Request access instead",
        detail: "Without an invite, submit an access request — an owner still must approve.",
        href: "/onboarding",
      },
    ];
  }

  if (input.kind === "missing_token") {
    return [
      {
        id: "signin",
        label: "Open invite from email",
        detail: "Use the full link in the invitation message. Partial URLs cannot be accepted.",
        href: "/signin",
        primary: true,
      },
      {
        id: "support",
        label: "Help & Support",
        detail: "Request a fresh invite to your verified email if the message is lost.",
        href: "/support",
      },
    ];
  }

  return [
    {
      id: "retry",
      label: "Retry invitation",
      detail:
        "Reload this page after checking your connection. No DEMO membership is invented while loading fails.",
      href: inviteReturn,
      primary: true,
    },
    {
      id: "support",
      label: "Help & Support",
      detail: "Open a ticket if the invite keeps failing to load.",
      href: "/support",
    },
  ];
}
