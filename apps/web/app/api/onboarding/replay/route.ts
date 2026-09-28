import { auth, replayOnboarding } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";
import { parseSecureJson, securityErrorResponse } from "../../../../lib/security/request";

const replayLimiter = createRateLimiter({ limit: 5, windowMs: 10 * 60_000, namespace: "onboarding-replay" });
const replayBody = z.object({}).strict();

/**
 * Setup runs once. This is the only way back into it, and only for the
 * person who is signed in. Their team membership is left alone.
 */
export async function POST(request: Request) {
  const current = await auth.api.getSession({ headers: await headers() });
  if (!current) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });
  try {
    const key = `${current.user.id}:${anonymizeIp(clientIp(request))}`;
    if (!(await replayLimiter.allow(key))) {
      return rateLimitedResponse("Wait a moment before starting setup again.");
    }
    await parseSecureJson(request, replayBody);
    const state = await withRls({ userId: current.user.id }, (client) =>
      replayOnboarding(client, current.user.id),
    );
    return Response.json({ ok: true, complete: state.complete }, {
      headers: { "cache-control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return securityErrorResponse(error, "Could not start setup again.");
  }
}
