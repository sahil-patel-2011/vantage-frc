/** Soft-UI helpers for `/invite` accept — exact-email invites, never DEMO membership. */

import { isAccessRole, roleLabel } from "@vantage/core/role-words";

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
  /** A resend or "new link" replaced this token; the team sent a newer one (0721). */
  | "replaced"
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
  // The one set of role words (@vantage/core/role-words): Owner, Mentor or coach, Student,
  // Parent or guest. The invite page said "Team member" where the shell said "Student".
  if (isAccessRole(normalized)) return roleLabel(normalized);
  if (normalized === "mentor") return "Mentor";
  if (normalized === "member") return "Member";
  return role.trim();
}

/** Onboarding, then back to this invite: finishing onboarding joins the team that invited you. */
export function inviteProfileHref(token?: string | null): string {
  const inviteReturn = token?.trim()
    ? `/invite?token=${encodeURIComponent(token.trim())}`
    : "/invite";
  return `/onboarding?next=${encodeURIComponent(inviteReturn)}`;
}

/**
 * Where a signed-in person on a valid invite goes next when their profile is not done.
 *
 * Back from signing in, a new account landed here on a disabled "Accept invitation", a small
 * "Finish your profile" link, and Terms/Privacy boxes that onboarding then asked again. A
 * profile that was never finished goes straight to onboarding, which asks for it and the
 * agreements once and joins the team when it is done (migration 0686). A finished profile that
 * still is not eligible stays here, so this can never bounce between the two pages.
 */
export function inviteProfileRedirect(input: {
  kind: InviteFlowKind;
  token: string | null | undefined;
  profileRequired: boolean;
  onboardingComplete: boolean | null;
}): string | null {
  if (input.kind !== "ready" || !input.profileRequired || input.onboardingComplete !== false) return null;
  if (!input.token?.trim()) return null;
  return inviteProfileHref(input.token);
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
  const rawName = preview.orgName?.trim() || null;
  // Most teams are named "Team 6925" — printing it after "Team 6925" read as a
  // stutter ("Team 6925 · Team 6925 · Scout").
  const name = rawName && team && rawName.toLowerCase() === team.toLowerCase() ? null : rawName;
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
  /** The link's token was replaced by a newer invite to the same address. */
  replaced?: boolean;
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
  if (input.replaced) return "replaced";
  if (input.emailMismatch) return "email_mismatch";
  if (input.authRequired) return "auth_required";
  if (input.error?.trim()) return "error";
  return "invalid";
}

/**
 * What the invite page knows beyond the kind: the team the invite was for (the preview names
 * it even when the link is dead), whether someone is signed in, and whether they are the
 * person it was for. Expired, cancelled and replaced links never named the team, so a parent
 * with children on two teams could not tell which one's invite had expired (QA A3-10).
 */
export type InvitePageContext = {
  team?: string | null;
  signedIn?: boolean;
  /** Signed in as the address the invite was sent to. */
  isInvitee?: boolean;
};

/** "Team 9301 · QA 3 Alpha" from a preview, or null. */
export function inviteTeamName(
  preview: Pick<InvitePreview, "orgName" | "teamNumber"> | null | undefined,
): string | null {
  if (!preview) return null;
  const identity = formatInviteTeamIdentity({ ...preview, role: "" });
  return identity === "Your team" ? null : identity;
}

/** Soft-UI empty / setup copy — never invents a joinable team. */
export function inviteEmptyCopy(
  kind: InviteFlowKind,
  detail?: string | null,
  context: InvitePageContext = {},
): InviteEmptyCopy {
  const team = context.team?.trim() || null;
  if (kind === "replaced") {
    return {
      kind,
      eyebrow: "TEAM INVITATION",
      title: "A newer invite replaced this link",
      description: `${team ?? "The team"} sent a newer invite to this address, so this link stopped working. Open the most recent invite email from Vantage, or ask the person who invited you.`,
      badge: "",
    };
  }
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
      eyebrow: "TEAM INVITATION",
      title: "Open your invite link",
      description:
        detail?.trim() ||
        "Use the link in the invite email. Not invited yet? Ask your team lead, or join the waitlist.",
      badge: "",
    };
  }
  if (kind === "auth_required") {
    return {
      kind,
      // One eyebrow and one heading: a "SIGN IN" pill, a "SIGN IN TO JOIN" eyebrow and this
      // heading said the same thing three times.
      eyebrow: "YOU'RE INVITED",
      title: "Sign in with the invited email",
      description:
        detail?.trim() ||
        "This invite is for one specific address. Sign in with that email, then accept. People without an invite go to the waitlist.",
      badge: "",
    };
  }
  if (kind === "email_mismatch") {
    return {
      kind,
      // Said once: a "WRONG EMAIL" pill, a "WRONG ACCOUNT" eyebrow, this heading and a warning
      // box said the same thing four times (QA A3-28).
      eyebrow: "TEAM INVITATION",
      title: "You're signed in with a different email",
      description:
        detail?.trim() ||
        "Sign out, then sign in with the address this invite was sent to.",
      badge: "",
    };
  }
  if (kind === "expired") {
    return {
      kind,
      eyebrow: "INVITE EXPIRED",
      title: team ? `Your invite to ${team} has expired` : "This invitation has expired",
      description:
        detail?.trim() ||
        "Ask the person who invited you to send a new one. Invites work for a day to a week, as the team chose.",
      badge: "Expired",
    };
  }
  if (kind === "accepted") {
    // A used link told a signed-out stranger "You are on the team"; only the person it was for,
    // signed in, is told they joined (QA A3-10).
    if (context.signedIn && context.isInvitee) {
      return {
        kind,
        eyebrow: "TEAM INVITATION",
        title: team ? `You already joined ${team}` : "You already used this invite",
        description: "Home opens on your team.",
        badge: "",
      };
    }
    return {
      kind,
      eyebrow: "TEAM INVITATION",
      title: "This invite was already used",
      description: context.signedIn
        ? "It was used by a different account. Ask the team for an invite to your own email."
        : "Each invite link works once. If it was yours, sign in with that email. Otherwise ask the team for a new invite.",
      badge: "",
    };
  }
  if (kind === "revoked") {
    return {
      kind,
      // Said once: a "Revoked" pill, an "INVITE REVOKED" eyebrow and the heading said it three times.
      eyebrow: "TEAM INVITATION",
      title: team ? `${team} cancelled this invite` : "This invite was cancelled",
      description: detail?.trim() || "If you still want to join, ask the person who invited you for a new one.",
      badge: "",
    };
  }
  if (kind === "error") {
    return {
      kind,
      eyebrow: "TEAM INVITATION",
      title: "Couldn't open this invitation",
      description: "Check your connection and try again.",
      badge: "",
    };
  }
  return {
    kind: "invalid",
    eyebrow: "TEAM INVITATION",
    title: "This invite link doesn't work",
    description:
      detail?.trim() ||
      "The link may be cut off. Open it again straight from the email, or ask your team lead to send a new one.",
    badge: "",
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
  signedIn?: boolean;
  isInvitee?: boolean;
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
    if (input.signedIn && input.isInvitee) {
      const homeHref = input.orgId ? `/dashboard?orgId=${encodeURIComponent(input.orgId)}` : "/dashboard";
      return [
        {
          id: "home",
          label: "Open Home",
          detail: "Home shows what to do first on your team.",
          href: homeHref,
          primary: true,
        },
      ];
    }
    if (input.signedIn) return [];
    return [
      {
        id: "signin",
        label: "Sign in",
        detail: "If this invite was yours, sign in with that email and you land on your team.",
        href: "/signin",
        primary: true,
      },
    ];
  }

  if (input.kind === "expired" || input.kind === "revoked" || input.kind === "invalid" || input.kind === "replaced") {
    // "Already joined? Sign in" made no sense to someone already signed in.
    if (input.signedIn) return [];
    return [
      {
        id: "signin",
        label: "Already joined? Sign in",
        detail: "If you used this invite before, sign in and you land on your team.",
        href: "/signin",
        primary: true,
      },
    ];
  }

  if (input.kind === "missing_token") {
    return [
      {
        id: "waitlist",
        label: "Join the waitlist",
        detail: "Use this when no invite was sent to your email.",
        href: "/#waitlist",
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
