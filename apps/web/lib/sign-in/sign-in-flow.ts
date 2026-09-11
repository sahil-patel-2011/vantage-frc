/** Soft-UI helpers for `/signin` — closed waitlist access, never DEMO auth. */

import {
  raisedPricingStrip as catalogRaisedPricingStrip,
  raisedPricingSummaryLine,
  type CatalogPlanCode,
} from "@vantage/billing/catalog";

export type SignInMode = "password" | "email-otp" | "reset";

export type SignInAuthStatus = {
  waitlistOnly: true;
  publicSignup: false;
  databaseConfigured: boolean;
  emailOtpAvailable: boolean;
  email2faEnforced: boolean;
  passwordSignInAvailable: boolean;
  googleSignInAvailable: boolean;
  emailOtpReason: string | null;
  passwordReason: string | null;
};

export type SignInSetupKind = "email_otp" | "google" | "password" | "database";

export type SignInSetupCopy = {
  kind: SignInSetupKind;
  badge: string;
  title: string;
  description: string;
};

export type SignInNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type RaisedPriceItem = {
  id: string;
  label: string;
  price: string;
};

/** Catalog defaults shown on Soft-UI waitlist/pricing CTAs. */
export const SIGN_IN_RAISED_PRICES: RaisedPriceItem[] = catalogRaisedPricingStrip();

export const WAITLIST_ONLY_MESSAGE =
  "This account isn’t on a team yet. If you were invited, try the email on the invite. Otherwise join the waitlist.";

export const SIGN_IN_FAILED_MESSAGE = "Couldn’t sign in. Check your email and try again.";

const PUBLIC_EMAIL_UNAVAILABLE =
  "Email codes are off right now. Use Google, or ask the person who invited you.";

const PUBLIC_PASSWORD_UNAVAILABLE =
  "Password sign-in is off right now. Use Google or an email code.";

const PUBLIC_GOOGLE_UNAVAILABLE = "Google isn’t ready yet. Use an email code instead.";

/** Browser-safe copy — never surface env var names or provider secrets. */
export function publicEmailUnavailableCopy(reason?: string | null): string {
  const value = reason?.trim();
  if (!value) return PUBLIC_EMAIL_UNAVAILABLE;
  if (/RESEND|AUTH_EMAIL_FROM|DATABASE_/i.test(value)) return PUBLIC_EMAIL_UNAVAILABLE;
  return value;
}

export function publicPasswordUnavailableCopy(reason?: string | null): string {
  const value = reason?.trim();
  if (!value) return PUBLIC_PASSWORD_UNAVAILABLE;
  if (/DATABASE_/i.test(value)) return PUBLIC_PASSWORD_UNAVAILABLE;
  return value;
}

export function googleReady(status: Pick<SignInAuthStatus, "googleSignInAvailable">, googleEnabled: boolean) {
  return status.googleSignInAvailable || googleEnabled;
}

export function emailOtpSetupRequired(status: Pick<SignInAuthStatus, "emailOtpAvailable">) {
  return !status.emailOtpAvailable;
}

export function passwordSetupRequired(status: Pick<SignInAuthStatus, "passwordSignInAvailable">) {
  return !status.passwordSignInAvailable;
}

/** Soft-UI setup_required shells when a sign-in method cannot run. */
export function signInSetupCopy(
  kind: SignInSetupKind,
  status?: Pick<SignInAuthStatus, "emailOtpReason" | "passwordReason">,
): SignInSetupCopy {
  if (kind === "email_otp") {
    return {
      kind,
      badge: "Needs setup",
      title: "Email codes are off right now",
      description: publicEmailUnavailableCopy(status?.emailOtpReason),
    };
  }
  if (kind === "google") {
    return {
      kind,
      badge: "Needs setup",
      title: "Google isn’t ready yet",
      description: PUBLIC_GOOGLE_UNAVAILABLE,
    };
  }
  if (kind === "password") {
    return {
      kind,
      badge: "Needs setup",
      title: "Password sign-in is off right now",
      description: publicPasswordUnavailableCopy(status?.passwordReason),
    };
  }
  return {
    kind: "database",
    badge: "Needs setup",
    title: "Sign-in isn’t ready yet",
    description: "Google and email codes are not available. Join the waitlist, or ask the person who invited you.",
  };
}

/** One line under the title — buttons do the rest. */
export function signInSubtitle(_status?: Pick<SignInAuthStatus, "email2faEnforced" | "emailOtpAvailable">) {
  return "Google or an email code. Invite-only.";
}

/**
 * The banner shown when a method cannot run — and, crucially, the harder case
 * where *nothing* can run. "Use another enabled method" is a lie when Google is
 * unconfigured too, so that combination gets its own copy naming the real
 * situation: this deployment has no working sign-in yet.
 */
export function signInUnavailableCopy(input: {
  google: boolean;
  email: boolean;
}): SignInSetupCopy | null {
  if (input.email) return null;
  if (input.google) {
    return {
      kind: "email_otp",
      badge: "Needs setup",
      title: "Email codes are off right now",
      description:
        "A code cannot be sent right now. Continue with Google instead.",
    };
  }
  return {
    kind: "email_otp",
    badge: "Needs setup",
    title: "Sign-in isn’t ready yet",
    description:
      "Google and email codes are not available, so nothing you type here would be sent. Join the waitlist, or ask the person who invited you.",
  };
}

export function signInModeLabel(mode: SignInMode) {
  if (mode === "email-otp") return "Email code";
  if (mode === "reset") return "Reset password";
  return "Password";
}

export function signInProgressLabel(active: 1 | 2 | 3) {
  if (active === 1) return "Step 1 of 3 · Identity";
  if (active === 2) return "Step 2 of 3 · Verify";
  return "Step 3 of 3 · Team setup";
}

export function signInAccessNote() {
  return {
    title: "Invite only",
    body: "An owner has to add you.",
  };
}

/** Waitlist + pricing CTAs with raised catalog prices. */
export function signInNextActions(): SignInNextAction[] {
  return [
    {
      id: "waitlist",
      label: "Join waitlist",
      detail: "If you have not been invited, we email when your team is set up.",
      href: "/#waitlist",
      primary: true,
    },
    {
      id: "pricing",
      label: "View pricing",
      detail: raisedPricingSummaryLine(),
      href: "/pricing",
    },
  ];
}

export function raisedPricingStrip(): RaisedPriceItem[] {
  return catalogRaisedPricingStrip();
}

/** Re-export for callers that need plan codes from the shared catalog. */
export type { CatalogPlanCode };

export function oauthErrorMessage(code: string | null | undefined) {
  if (!code) return "";
  const normalized = code.toLowerCase();
  if (
    normalized.includes("signup") ||
    normalized.includes("unable_to_create") ||
    normalized.includes("user_not_found") ||
    normalized.includes("access_denied") ||
    normalized.includes("waitlist")
  ) {
    return WAITLIST_ONLY_MESSAGE;
  }
  return "Google sign-in didn’t finish. Try again, or use email.";
}
