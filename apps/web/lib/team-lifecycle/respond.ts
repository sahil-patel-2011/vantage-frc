import { isViewOnlyRefusal } from "@vantage/db/view-only";
import { REMEMBERED_TEAM_COOKIE } from "../nav/remembered-team";
import { publicErrorMessage } from "../security/public-error";
import { lifecycleAnswer, lifecycleRefusal, type LifecycleAction } from "./model";

const FALLBACK: Record<LifecycleAction, string> = {
  rename: "The team name didn't change. Try again.",
  leave: "You're still on the team. Try again in a minute.",
  delete_team: "The team wasn't deleted. Try again in a minute.",
  delete_account: "Your account wasn't deleted. Try again in a minute.",
};

/** The one error answer for the lifecycle routes: a plain sentence, never database text. */
export function lifecycleErrorResponse(error: unknown, action: LifecycleAction): Response {
  if (error instanceof Error && error.message === "Authentication required") {
    return Response.json({ error: "Sign in again to continue." }, { status: 401 });
  }
  const reason = lifecycleRefusal(error);
  if (reason) {
    const answer = lifecycleAnswer(reason, action);
    return Response.json({ error: answer.error, reason }, { status: answer.status });
  }
  if (isViewOnlyRefusal(error)) {
    return Response.json({ error: publicErrorMessage(error, FALLBACK[action]), reason: "view_only" }, { status: 403 });
  }
  return Response.json({ error: publicErrorMessage(error, FALLBACK[action]) }, { status: 500 });
}

/** Forget the remembered team (proxy.ts) so the next bare team page picks one the person is on. */
export function forgetRememberedTeam(headers: Headers): void {
  headers.append("set-cookie", `${REMEMBERED_TEAM_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

/**
 * Expire Better Auth's session cookies. The sessions themselves are already deleted with the
 * account, so these are only tidying up; a `__Secure-` cookie is only replaced by a Secure one.
 */
export function expireSessionCookies(headers: Headers): void {
  for (const name of ["session_token", "session_data", "dont_remember"]) {
    headers.append("set-cookie", `better-auth.${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    headers.append("set-cookie", `__Secure-better-auth.${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  }
}
