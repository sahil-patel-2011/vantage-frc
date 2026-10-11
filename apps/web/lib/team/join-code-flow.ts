import { inviteSignInHref } from "../invite/invite-flow";

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
