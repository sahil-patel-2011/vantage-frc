import { ROLE_LABELS } from "@vantage/core/role-words";
import { inviteSignInHref } from "../invite/invite-flow";

/**
 * Team admin's sentence for the join code: whether it is on, and what joiners get, in the role
 * words. The code used to be on for every new team, hidden in a closed panel, with nothing
 * saying that anyone with it joins (QA A3-01).
 */
export function joinCodeAccessSentence(state: { enabled: boolean; joinRole?: "scout" | "viewer"; teamNumber?: number }): string {
  const team = state.teamNumber ? `team number ${state.teamNumber}` : "your team number";
  const role = state.joinRole === "scout" ? "scout" : "viewer";
  if (!state.enabled) {
    return `Off. Turn it on to let people join with ${team} and a six-digit code instead of an email invite.`;
  }
  return (
    `On. Anyone with ${team} and this code can join after verifying their email, as ${ROLE_LABELS[role]}` +
    (role === "viewer" ? " (can look, can't change) until you change their access." : ".") +
    " People who say they're a parent always join as Parent or guest. You get a notice each time someone joins."
  );
}

/** "You're already on <team>": the team, and Home on it. */
export type TeamJoinMember = { orgId: string; orgName: string | null; teamNumber: number; href: string };

export type TeamJoinNextStep =
  | { kind: "member"; member: TeamJoinMember }
  | { kind: "go"; href: string }
  | { kind: "error" };

/**
 * What /join-team does with the join route's answer.
 *
 * - Already on that team: say so, with Home. No new invitation.
 * - Signed in: the invitation page, where Accept (or onboarding, for a new profile) joins.
 * - Signed out: straight to sign-in for that invitation. The invitation page used to stop the
 *   student on "YOU'RE INVITED · Sign in with the invited email … People without an invite go to
 *   the waitlist" and a "Sign in to accept" button; sign-in already shows "You're joining Team N"
 *   and fills in the invited email from the same token.
 * Only a same-site invitation path is followed (`validInvitePath`), never an arbitrary URL.
 */
export function teamJoinNextStep(
  data: Record<string, unknown> | null | undefined,
  options: { signedIn: boolean; validInvitePath: (value: unknown) => string | null },
): TeamJoinNextStep {
  if (data?.alreadyMember === true && typeof data.orgId === "string" && /^[0-9a-f-]{36}$/i.test(data.orgId)) {
    return {
      kind: "member",
      member: {
        orgId: data.orgId,
        orgName: typeof data.orgName === "string" ? data.orgName : null,
        teamNumber: typeof data.teamNumber === "number" ? data.teamNumber : 0,
        href: `/dashboard?orgId=${encodeURIComponent(data.orgId)}`,
      },
    };
  }
  const invite = options.validInvitePath(data?.href);
  if (!invite) return { kind: "error" };
  if (options.signedIn) return { kind: "go", href: invite };
  const token = new URL(invite, "https://vantage.invalid").searchParams.get("token");
  return { kind: "go", href: inviteSignInHref(token) };
}

/**
 * The join code as typed or pasted: digits only, at most six. The field had maxLength={6}, so
 * the browser cut a pasted "206 436" to "206 43" before the digits were kept, leaving five
 * numbers and a Continue button that stayed grey with no reason given.
 */
export function joinCodeDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

/** The team number as typed or pasted ("Team 6925" → "6925"): digits only, at most five. */
export function teamNumberDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 5);
}

/** What is still missing under the code field, or null when it is complete or empty. */
export function joinCodeHint(pin: string): string | null {
  if (!pin || pin.length === 6) return null;
  const left = 6 - pin.length;
  return `Enter all 6 numbers (${left} more to go).`;
}

/**
 * The sentence for a refused code. A lockout names the time to come back ("Try again at
 * 8:42 PM"); a wrong code says only to check it, never "wait fifteen minutes" on the first miss.
 */
export function joinFailureMessage(
  status: number,
  body: { error?: unknown; code?: unknown; retryAt?: unknown } | null | undefined,
  formatTime: (date: Date) => string = (date) => date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
): string {
  if (body?.code === "join_code_locked" && typeof body.retryAt === "string") {
    const at = new Date(body.retryAt);
    if (Number.isFinite(at.getTime())) {
      return `Too many wrong tries. Try again at ${formatTime(at)}, or ask a team admin for an email invite.`;
    }
  }
  if (status === 429) return "Too many tries from here. Wait a few minutes, then try again.";
  if (typeof body?.error === "string" && body.error.trim()) return body.error.trim();
  return "Could not join. Check the details and try again.";
}
