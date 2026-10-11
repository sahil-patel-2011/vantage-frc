import { randomBytes } from "node:crypto";
import { auth, peekOrganizationInvite } from "@vantage/core";
import { requestPool, withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import {
  anonymizeIp,
  clientIp,
  createRateLimiter,
  rateLimitedResponse,
} from "../../../../lib/rate-limit";
import {
  parseSecureJson,
  securityErrorResponse,
} from "../../../../lib/security/request";

const limiter = createRateLimiter({
  limit: 120,
  windowMs: 15 * 60_000,
  namespace: "team-code-join",
});
const input = z
  .object({
    teamNumber: z.number().int().min(1).max(99999),
    pin: z.string().regex(/^\d{6}$/),
    email: z.string().trim().email().max(254),
  })
  .strict();

const noStore = { "Cache-Control": "no-store" };

/** The signed-in person's own membership of this team number, if any (RLS: their own rows). */
async function ownMembership(userId: string, teamNumber: number) {
  return withRls({ userId }, async (client) =>
    (
      await client.query<{ orgId: string; orgName: string | null; teamNumber: number }>(
        `SELECT o.id::text AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber"
           FROM memberships m JOIN organizations o ON o.id = m.org_id
          WHERE m.user_id = $1::uuid AND o.team_number = $2::int
          LIMIT 1`,
        [userId, teamNumber],
      )
    ).rows[0] ?? null,
  );
}

/** The team the new code invitation is for, for "You're joining …" copy. Never fatal. */
async function invitedTeam(token: string) {
  const client = await requestPool.connect();
  try {
    const preview = await peekOrganizationInvite(client, token);
    return preview ? { orgName: preview.orgName, teamNumber: preview.teamNumber } : null;
  } catch {
    return null;
  } finally {
    client.release();
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseSecureJson(request, input),
      ip = anonymizeIp(clientIp(request), "team-code-join");
    if (!(await limiter.allow(ip)))
      return rateLimitedResponse(
        "Too many attempts. Wait fifteen minutes and try again.",
      );

    // Someone already on this team who enters its code is told so, with a way Home, instead of
    // being handed a new (scout) invitation for a team they are on. Only their own membership
    // is read, so this says nothing about anyone else.
    const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
    if (session) {
      const member = await ownMembership(session.user.id, body.teamNumber);
      if (member) {
        return Response.json(
          {
            alreadyMember: true,
            orgId: member.orgId,
            orgName: member.orgName,
            teamNumber: member.teamNumber,
            href: `/dashboard?orgId=${encodeURIComponent(member.orgId)}`,
          },
          { headers: noStore },
        );
      }
    }

    const token = randomBytes(32).toString("base64url");
    const result = await requestPool.query<{ id: string | null }>(
      "SELECT request_team_code_invite($1,$2,$3,$4,$5) AS id",
      [body.teamNumber, body.pin, body.email.toLowerCase(), ip, token],
    );
    if (!result.rows[0]?.id)
      return Response.json(
        {
          error:
            "Check your team number and join code, or ask a team admin for an invitation. After several attempts, wait fifteen minutes.",
        },
        { status: 400, headers: noStore },
      );
    const team = await invitedTeam(token);
    return Response.json(
      {
        href: `/invite?token=${encodeURIComponent(token)}`,
        orgName: team?.orgName ?? null,
        teamNumber: team?.teamNumber ?? body.teamNumber,
      },
      { headers: noStore },
    );
  } catch (error) {
    return securityErrorResponse(
      error,
      "Could not join this team. Try again or ask for an invitation.",
    );
  }
}
