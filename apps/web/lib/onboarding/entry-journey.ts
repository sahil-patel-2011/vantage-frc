import { safeAppPath } from "../security/safe-navigation";

/** Completion must not send a returning member into another entry screen. */
export function onboardingReturnPath(next: string | null, fallback: string): string {
  const path = safeAppPath(next, fallback);
  let pathname: string;
  try { pathname = decodeURIComponent(new URL(path, "https://vantage.invalid").pathname).replace(/\/+$/, "") || "/"; }
  catch { return fallback; }
  return ["/onboarding", "/signin", "/sign-in", "/access-unavailable"].some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`)) ? fallback : path;
}

/** The join-code endpoint hands off to one same-site invitation, never an arbitrary URL. */
export function teamJoinInvitePath(value: unknown): string | null {
  if (typeof value !== "string" || safeAppPath(value, "") !== value) return null;
  const url = new URL(value, "https://vantage.invalid");
  const token = url.searchParams.get("token");
  return url.pathname === "/invite" && token && /^[a-zA-Z0-9_-]{32,128}$/.test(token) ? `/invite?token=${encodeURIComponent(token)}` : null;
}

/** Never restore the old team-only keys on a shared device: their author is unknown. */
export function onboardingAnswersKey(userId: string | null | undefined, orgId: string | null): string | null {
  return userId ? `vantage.onboarding.answers:v2:${encodeURIComponent(userId)}:${encodeURIComponent(orgId ?? "personal")}` : null;
}

export function confirmedOnboardingState(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return typeof state.complete === "boolean"
    && ["approved", "invited", "pending", "declined", "withdrawn", "none"].includes(String(state.accessStatus))
    && ["profile", "team", "preferences", "complete"].includes(String(state.currentStep));
}
