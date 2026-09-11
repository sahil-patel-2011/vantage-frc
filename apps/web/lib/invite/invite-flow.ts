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
  if (normalized === "scout") return "Scout";
  if (normalized === "viewer") return "Viewer";
  if (normalized === "mentor") return "Mentor";
  if (normalized === "member") return "Member";
  return role.trim();
}

/** Sign-in return that preserves the invite token. */
export function inviteSignInHref(token?: string | null): string {
  const inviteReturn = token?.trim()
    ? `/invite?token=${encodeURIComponent(token.trim())}`
    : "/invite";
  return `/signin?next=${encodeURIComponent(inviteReturn)}`;
}

/**
 * Headline shown while a person is still authenticating: the sign-in card keeps
 * the invite in view the whole way so nobody wonders what they are joining.
 * Blank-safe — an unloaded preview never invents a team number.
 */
export function inviteJoiningHeadline(
  preview: Pick<InvitePreview, "orgName" | "teamNumber"> | null | undefined,
): string {
  const teamNumber = preview?.teamNumber;
  if (teamNumber != null && Number.isFinite(teamNumber)) {
    return `You’re joining Team ${teamNumber}`;
  }
  const name = preview?.orgName?.trim();
  if (name) return `You’re joining ${name}`;
  return "You’re joining a team";
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
  return parts.length > 0 ? parts.join(" · ") : "Your team";
}

/**
 * Both consent checkboxes are shown unless this login has already accepted BOTH
 * documents. Migration 0460 backfills nothing, so a profile holding only the old
 * combined 0163 terms timestamp is asked again.
 */
export function inviteLegalRequired(input: {
  termsAcceptedAt?: string | null;
  privacyAcceptedAt?: string | null;
}): boolean {
  return !input.termsAcceptedAt?.trim() || !input.privacyAcceptedAt?.trim();
}


export function inviteCanAccept(input: {
  termsAccepted: boolean;
  privacyAccepted: boolean;
  legalRequired: boolean;
  status?: string | null;
}): boolean {
  if (normalizeInviteStatus(input.status) !== "pending") return false;
  if (input.legalRequired && !(input.termsAccepted && input.privacyAccepted)) return false;
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
  // Loading is checked first: a bare `/invite` may still be recovering the
  // stashed token, and flashing "link incomplete" at that moment is a lie.
  if (input.loading) return "loading";
  if (!input.token.trim()) return "missing_token";
  if (input.preview) {
    const status = normalizeInviteStatus(input.preview.status);
    if (status === "pending") {
      const expiresMs = Date.parse(input.preview.expiresAt);
      if (Number.isFinite(expiresMs) && expiresMs <= Date.now()) return "expired";
      if (input.emailMismatch) return "email_mismatch";
      if (input.authRequired) return "auth_required";
      return "ready";
    }
    if (status === "expired") return "expired";
    if (status === "accepted") return "accepted";
    if (status === "revoked") return "revoked";
    return "invalid";
  }
  if (input.emailMismatch) return "email_mismatch";
  if (input.authRequired) return "auth_required";
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
      description: "Checking this invite. Nothing is joined until you accept.",
    };
  }
  if (kind === "missing_token") {
    return {
      kind,
      eyebrow: "INVITE LINK INCOMPLETE",
      title: "This invitation link is incomplete",
      description:
        detail?.trim() ||
        "Open the full link from your invite email or the copy your captain shared. People without an invite go to the waitlist.",
      badge: "Link missing",
    };
  }
  if (kind === "auth_required") {
    return {
      kind,
      eyebrow: "SIGN IN TO JOIN",
      title: "Sign in with the invited email",
      description:
        detail?.trim() ||
        "This invite is for one specific address. Sign in with that email, then accept. People without an invite go to the waitlist.",
      badge: "Sign in",
    };
  }
  if (kind === "email_mismatch") {
    return {
      kind,
      eyebrow: "WRONG ACCOUNT",
      title: "You're signed in with a different email",
      description:
        detail?.trim() ||
        "Sign out, then sign in with the address this invite was sent to.",
      badge: "Wrong email",
    };
  }
  if (kind === "expired") {
    return {
      kind,
      eyebrow: "INVITE EXPIRED",
      title: "This invitation has expired",
      description:
        detail?.trim() ||
        "Ask a team owner or admin to send a new invite to your email.",
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
        "If you already joined, choose your team. Otherwise ask an owner for a fresh invite.",
      badge: "Used",
    };
  }
  if (kind === "revoked") {
    return {
      kind,
      eyebrow: "INVITE REVOKED",
      title: "This invitation was cancelled",
      description:
        detail?.trim() ||
        "A team leader revoked this invite. Request a new one if you still need access.",
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
        "A network or server issue prevented loading. Retry when you're back online.",
      badge: "Retry",
    };
  }
  return {
    kind: "invalid",
    eyebrow: "INVITE UNAVAILABLE",
    title: "This invitation is invalid or unavailable",
    description:
      detail?.trim() ||
      "The link may be wrong, already used, or revoked. Ask your team for a new invite.",
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
  const signInHref = inviteSignInHref(token);

  if (input.kind === "ready") {
    return [];
  }

  if (input.kind === "auth_required" || input.kind === "email_mismatch") {
    return [
      {
        id: "signin",
        label: input.kind === "email_mismatch" ? "Sign in with the invited email" : "Sign in to accept",
        detail:
          input.kind === "email_mismatch"
            ? "Sign out first, then use the address on this invite."
            : "Use the email this invite was sent to — Google or email code.",
        href: signInHref,
        primary: true,
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
        label: "Choose your team",
        detail: "Continue in the team you already joined.",
        href: workspaceHref,
        primary: true,
      },
    ];
  }

  if (input.kind === "expired" || input.kind === "revoked" || input.kind === "invalid") {
    return [
      {
        id: "workspace",
        label: "Check team access",
        detail: "If you already belong to a team, pick it from Your team.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  if (input.kind === "missing_token") {
    return [
      {
        id: "signin",
        label: "Open invite from email",
        detail: "Use the full link in the invitation. Partial URLs cannot be accepted.",
        href: "/signin",
        primary: true,
      },
    ];
  }

  return [
    {
      id: "retry",
      label: "Retry invitation",
      detail: "Reload this page after checking your connection.",
      href: inviteReturn,
      primary: true,
    },
  ];
}
