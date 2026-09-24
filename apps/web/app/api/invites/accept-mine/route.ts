import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";
import { parseSecureJson, securityErrorResponse } from "../../../../lib/security/request";

const limiter = createRateLimiter({ limit: 20, windowMs: 10 * 60_000, namespace: "invite-accept-mine" });
const schema = z.object({ orgId: z.string().uuid() }).strict();

/**
 * POST /api/invites/accept-mine  { orgId }
 *
 * Join a team that invited the signed-in email, without the token from the invite email.
 * Signing in already proved the address, which is all the invite link proves; the SECURITY
 * DEFINER accept_my_org_invite (0686) re-checks the verified email, the match, and expiry.
 */
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });
    if (!(await limiter.allow(`${session.user.id}:${anonymizeIp(clientIp(request))}`))) {
      return rateLimitedResponse("Too many tries. Wait a few minutes and try again.");
    }
    const body = await parseSecureJson(request, schema);
    const orgId = await withRls({ userId: session.user.id }, async (client) => {
      const result = await client.query<{ orgId: string }>(`SELECT accept_my_org_invite($1::uuid) AS "orgId"`, [body.orgId]);
      return result.rows[0]?.orgId ?? null;
    });
    const response = Response.json({ orgId });
    response.headers.set("cache-control", "private, no-store, max-age=0");
    return response;
  } catch (error) {
    const message = String((error as Error | null)?.message ?? "");
    if (/invalid or already used/i.test(message)) {
      return Response.json({ error: "That invite was already used or withdrawn. Ask your team to invite you again." }, { status: 409 });
    }
    if (/has expired/i.test(message)) {
      return Response.json({ error: "That invite expired. Ask your team to send a new one." }, { status: 410 });
    }
    return securityErrorResponse(error, "Couldn't join the team. Try again.");
  }
}
