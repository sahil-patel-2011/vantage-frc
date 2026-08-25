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
  badge: "setup_required";
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
  "This account isn’t on a team yet. Join the waitlist, or sign in with an authorized email.";

export const SIGN_IN_FAILED_MESSAGE = "Couldn’t sign in. Check your email and try again.";

const PUBLIC_EMAIL_UNAVAILABLE =
  "Email code sign-in is temporarily unavailable. Use another enabled method or contact your team leader.";

const PUBLIC_PASSWORD_UNAVAILABLE =
  "Password sign-in is temporarily unavailable. Use another enabled method or contact your team leader.";

const PUBLIC_GOOGLE_UNAVAILABLE = "Google isn’t set up yet. Use email instead.";

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
      badge: "setup_required",
      title: "Email codes need the mail provider",
      description: publicEmailUnavailableCopy(status?.emailOtpReason),
    };
  }
  if (kind === "google") {
    return {
      kind,
      badge: "setup_required",
      title: "Google is unavailable",
      description: PUBLIC_GOOGLE_UNAVAILABLE,
    };
  }
  if (kind === "password") {
    return {
      kind,
      badge: "setup_required",
      title: "Password sign-in is unavailable",
      description: publicPasswordUnavailableCopy(status?.passwordReason),
    };
  }
  return {
    kind: "database",
    badge: "setup_required",
    title: "Sign-in needs a configured workspace database",
    description: publicPasswordUnavailableCopy(status?.passwordReason),
  };
}

/** One line under the title — buttons do the rest. */
export function signInSubtitle(_status?: Pick<SignInAuthStatus, "email2faEnforced" | "emailOtpAvailable">) {
  return "Same sign-in for every team.";
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
      badge: "setup_required",
      title: "Email codes are off right now",
      description:
        "The mail provider isn’t reachable, so no code can be sent. Continue with Google instead.",
    };
  }
  return {
    kind: "email_otp",
    badge: "setup_required",
    title: "Sign-in isn’t configured on this deployment",
    description:
      "Neither email codes nor Google are available, so no one can sign in yet. Nothing you type here would be sent. Ask whoever set up this Vantage deployment to finish auth configuration.",
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
      detail: "Request access — teams are provisioned, not self-served.",
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
