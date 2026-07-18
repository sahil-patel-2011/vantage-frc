import { acceptOrganizationInvite, assertTermsAccepted, auth, recordLegalAcceptance } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  anonymizeIp,
  clientIp,
  createRateLimiter,
  rateLimitedResponse,
} from "../../../../lib/rate-limit";

const limiter = createRateLimiter({ limit: 20, windowMs: 10 * 60_000, namespace: "invite-accept" });

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

    const key = `${session.user.id}:${anonymizeIp(clientIp(request))}`;
    if (!(await limiter.allow(key))) {
      return rateLimitedResponse("Too many invite attempts. Wait a few minutes and try again.");
    }

    const body = (await request.json()) as { token?: string; termsAccepted?: boolean };
    if (!body.token) return Response.json({ error: "Invite token is required" }, { status: 400 });
    assertTermsAccepted(body.termsAccepted);
    const orgId = await withRls({ userId: session.user.id }, async (client) => { const acceptedOrgId = await acceptOrganizationInvite(client, session.user.id, body.token!); await recordLegalAcceptance(client, session.user.id); return acceptedOrgId; });
    return Response.json({ orgId });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invite could not be accepted" },
      { status: 400 },
    );
  }
}
