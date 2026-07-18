import { acceptOrganizationInvite, assertTermsAccepted, auth, recordLegalAcceptance } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import {
  anonymizeIp,
  clientIp,
  createRateLimiter,
  rateLimitedResponse,
} from "../../../../lib/rate-limit";
import { parseSecureJson, securityErrorResponse } from "../../../../lib/security/request";

const limiter = createRateLimiter({ limit: 20, windowMs: 10 * 60_000, namespace: "invite-accept" });
const acceptSchema = z.object({
  token: z.string().trim().length(43).regex(/^[A-Za-z0-9_-]+$/),
  termsAccepted: z.literal(true),
}).strict();

function privateJson(value: unknown, init?: ResponseInit) {
  const response = Response.json(value, init);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  return response;
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

    const key = `${session.user.id}:${anonymizeIp(clientIp(request))}`;
    if (!(await limiter.allow(key))) {
      return rateLimitedResponse("Too many invite attempts. Wait a few minutes and try again.");
    }

    const body = await parseSecureJson(request, acceptSchema);
    assertTermsAccepted(body.termsAccepted);
    const orgId = await withRls({ userId: session.user.id }, async (client) => { const acceptedOrgId = await acceptOrganizationInvite(client, session.user.id, body.token); await recordLegalAcceptance(client, session.user.id); return acceptedOrgId; });
    return privateJson({ orgId });
  } catch (error) {
    return securityErrorResponse(error, "Invite could not be accepted");
  }
}
