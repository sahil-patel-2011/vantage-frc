import { auth, suggestTeamInvite } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import { createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";
import { parseSecureJson, securityErrorResponse } from "../../../../lib/security/request";
import { inviteEmailProblem } from "../../../../lib/team/invite-email-address";

/**
 * POST /api/team/invite-suggestion — someone on the team who can't invite (a student, a
 * parent) asks the owner and mentors to invite a person: "Mr. Lee, lee@school.org, as a
 * mentor or coach". Before, a student's only path was the Team admin page saying
 * "Team administrator access required" (QA A3-04).
 *
 * suggest_team_invite (0721) checks membership, the address and the access, writes one notice
 * to each owner and mentor or coach, and allows five suggestions per person per hour. Nothing
 * is joined or invited by this: an owner still sends the invite.
 */
const limiter = createRateLimiter({ limit: 10, windowMs: 60 * 60_000, namespace: "invite-suggestion" });
const input = z
  .object({
    orgId: z.string().uuid(),
    email: z.string().max(400),
    role: z.enum(["admin", "scout", "viewer"]),
    note: z.string().max(400).optional(),
  })
  .strict();

const json = (value: unknown, init?: ResponseInit) =>
  Response.json(value, { ...init, headers: { "cache-control": "private, no-store" } });

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return json({ error: "Your session ended. Sign in again." }, { status: 401 });
    if (!(await limiter.allow(session.user.id))) {
      return rateLimitedResponse("You sent several suggestions just now. Try again in an hour.");
    }
    const body = await parseSecureJson(request, input);
    const problem = inviteEmailProblem(body.email);
    if (problem) return json({ error: problem }, { status: 400 });
    if ((body.note ?? "").trim().length > 280) {
      return json({ error: "Keep the note to 280 characters or fewer." }, { status: 400 });
    }
    const { notified } = await withRls({ userId: session.user.id, orgId: body.orgId }, (client) =>
      suggestTeamInvite(client, { orgId: body.orgId, email: body.email, role: body.role, note: body.note ?? null }),
    );
    if (!notified) {
      return json(
        { notified, error: "Nobody on this team can invite people yet. Ask whoever set up the team." },
        { status: 409 },
      );
    }
    return json({ notified });
  } catch (error) {
    // suggest_team_invite raises plain sentences (SQLSTATE P0001); say them, never raw errors.
    const message = error instanceof Error ? error.message : "";
    if (/not a member of this team/i.test(message)) {
      return json({ error: "You're not on this team, so you can't suggest someone for it." }, { status: 403 });
    }
    if (/five suggestions this hour/i.test(message)) {
      return json({ error: "You sent five suggestions this hour. Try again later." }, { status: 429 });
    }
    if (/full email address|what they would do|280 characters/i.test(message)) {
      return json({ error: message.replace(/^ERROR:\s*/, "") }, { status: 400 });
    }
    return securityErrorResponse(error, "That suggestion didn't send. Try again.");
  }
}
