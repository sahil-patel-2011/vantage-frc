/** Soft-UI helpers for `/signin` — closed waitlist access, never DEMO auth. */

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
export const SIGN_IN_RAISED_PRICES: RaisedPriceItem[] = [
  { id: "access", label: "Access", price: "$55" },
  { id: "individual", label: "Individual Pro / Max", price: "$79 / $119" },
  { id: "team", label: "Team Pro / Max", price: "$229 / $449" },
];

export const WAITLIST_ONLY_MESSAGE =
  "Vantage is waitlist-only right now. Join the waitlist for access, or sign in with an authorized account.";

export const SIGN_IN_FAILED_MESSAGE =
  "We could not sign you in. Check the email and code/password, or request a fresh email code.";

const PUBLIC_EMAIL_UNAVAILABLE =
  "Email code sign-in is temporarily unavailable. Use another enabled method or contact your team leader.";

const PUBLIC_PASSWORD_UNAVAILABLE =
  "Password sign-in is temporarily unavailable. Use another enabled method or contact your team leader.";

const PUBLIC_GOOGLE_UNAVAILABLE =
  "Google sign-in is not configured for this deployment yet. Use email and password or an email code if available.";

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
      title: "Google sign-in is unavailable",
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

/** Lead subtitle clarifying Google vs password vs email OTP. */
export function signInSubtitle(status: Pick<SignInAuthStatus, "email2faEnforced" | "emailOtpAvailable">) {
  if (status.email2faEnforced) {
    return "Continue with Google or password, then enter an email code — or sign in with an email code alone.";
  }
  if (status.emailOtpAvailable) {
    return "Continue with Google, email and password, or a one-time email code.";
  }
  return "Continue with Google or email and password. Email codes are setup_required until mail delivery is configured.";
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
    title: "Closed team access",
    body: "Sign-in proves who you are. An invite or team-leader approval controls which workspace you can enter — never a public signup.",
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
      detail: "Access $55 · Individual $79/$119 · Team $229/$449",
      href: "/pricing",
    },
  ];
}

export function raisedPricingStrip(): RaisedPriceItem[] {
  return SIGN_IN_RAISED_PRICES;
}

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
  return "Google sign-in could not be completed. If you already have access, try again or use email and password.";
}
