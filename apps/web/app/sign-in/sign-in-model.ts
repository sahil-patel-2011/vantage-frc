import { formatCooldown, formatCountdown } from "../../lib/sign-in";
import { PENDING_INVITE_STORAGE_KEY } from "../../lib/invite";
import type { OnboardingGateSnapshot } from "../../lib/sign-in";

export type SignInBusy = "idle" | "sending" | "verifying" | "resending" | "google" | "leaving";

export type PasswordPanel = "closed" | "password" | "reset";

/** What the read-only session probe (`GET /api/auth/email-2fa`) told us. */
export type SessionProbe =
  | { state: "checking" }
  | { state: "none" }
  | { state: "needs_verification"; emailHint: string }
  | { state: "active"; emailHint: string };

export type Email2faProbePayload = {
  authenticated?: boolean;
  requiresVerification?: boolean;
  emailHint?: string;
};

export type StorageGet = {
  getItem(key: string): string | null;
};

export function storedInviteTokenFrom(store: StorageGet | null | undefined): string | null {
  if (!store) return null;
  try {
    return store.getItem(PENDING_INVITE_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function sessionProbeFromPayload(
  response: { ok: boolean; status: number },
  data: Email2faProbePayload | null,
): SessionProbe {
  if (response.status === 401 || !response.ok || !data?.authenticated) {
    return { state: "none" };
  }
  return data.requiresVerification
    ? { state: "needs_verification", emailHint: data.emailHint ?? "" }
    : { state: "active", emailHint: data.emailHint ?? "" };
}

export async function readOnboardingGate(): Promise<OnboardingGateSnapshot | null> {
  try {
    const response = await fetch("/api/onboarding", { credentials: "include" });
    if (!response.ok) return null;
    return (await response.json()) as OnboardingGateSnapshot;
  } catch {
    return null;
  }
}

export function continueAsLabel(working: boolean, emailHint: string): string {
  return working ? "Continuing…" : `Continue as ${emailHint || "this account"}`;
}

export function googleButtonLabel(busy: SignInBusy): string {
  return busy === "google" ? "Opening Google…" : "Continue with Google";
}

export function emailSubmitLabel(busy: SignInBusy): string {
  return busy === "sending" ? "Sending code…" : "Email me a sign-in code";
}

export function verifySubmitLabel(busy: SignInBusy): string {
  return busy === "verifying" ? "Verifying…" : "Verify and continue";
}

export function resendLabel(opts: { ready: boolean; busy: SignInBusy; seconds: number }): string {
  if (opts.ready) {
    return opts.busy === "resending" ? "Sending…" : "Send a new code";
  }
  return `Resend in ${formatCooldown(opts.seconds)}`;
}

export function codeExpiryCopy(expired: boolean, seconds: number): string {
  return expired
    ? "This code is no longer valid. Send a new one."
    : `Expires in ${formatCountdown(seconds)}.`;
}

export function inviteBannerBody(email: string | null | undefined): string {
  return email
    ? `Sign in as ${email} — this invite only works for that address. You’ll land back on the acceptance screen.`
    : "Finish signing in and you’ll come straight back to the acceptance screen.";
}

export function passwordSubmitLabel(
  panel: Exclude<PasswordPanel, "closed">,
  opts: { resetSent: boolean; working: boolean },
): string {
  switch (panel) {
    case "reset":
      return opts.resetSent ? "Set new password" : "Send reset code";
    case "password":
      return opts.working ? "Signing in…" : "Sign in with password";
    default: {
      const _never: never = panel;
      return _never;
    }
  }
}

export function describeSignInBusy(busy: SignInBusy): string {
  switch (busy) {
    case "idle":
      return "idle";
    case "sending":
      return "sending a sign-in code";
    case "verifying":
      return "verifying a sign-in code";
    case "resending":
      return "sending a new code";
    case "google":
      return "opening Google";
    case "leaving":
      return "continuing into the team";
    default: {
      const _never: never = busy;
      return _never;
    }
  }
}
