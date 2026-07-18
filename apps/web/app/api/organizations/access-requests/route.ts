import { auth, listWorkspaceAccessRequests, reviewWorkspaceAccessRequest } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";
import { parseSecureJson, securityErrorResponse } from "../../../../lib/security/request";

const reviewLimiter = createRateLimiter({ limit: 30, windowMs: 10 * 60_000, namespace: "access-review" });
const reviewSchema = z.object({
  orgId: z.string().uuid(),
  requestId: z.string().uuid(),
  decision: z.enum(["approved", "declined"]),
  role: z.enum(["scout", "viewer"]).optional(),
}).strict();

async function currentUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

function privateJson(value: unknown, init?: ResponseInit) {
  const response = Response.json(value, init);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  return response;
}

export async function GET(request: Request) {
  const userId = await currentUser();
  if (!userId) return Response.json({ error: "Authentication required" }, { status: 401 });
  const orgId = new URL(request.url).searchParams.get("orgId")?.trim();
  if (!orgId || !z.string().uuid().safeParse(orgId).success) {
    return Response.json({ error: "A valid orgId is required" }, { status: 400 });
  }
  try {
    const requests = await withRls({ userId, orgId }, (client) => listWorkspaceAccessRequests(client, orgId));
    return privateJson({ requests });
  } catch (error) {
    return securityErrorResponse(error, "Could not load access requests.");
  }
}

export async function PATCH(request: Request) {
  const userId = await currentUser();
  if (!userId) return Response.json({ error: "Authentication required" }, { status: 401 });
  try {
    if (!(await reviewLimiter.allow(`${userId}:${anonymizeIp(clientIp(request))}`))) {
      return rateLimitedResponse("Too many access reviews. Wait a moment and try again.");
    }
    const body = await parseSecureJson(request, reviewSchema);
    const reviewed = await withRls({ userId, orgId: body.orgId }, (client) =>
      reviewWorkspaceAccessRequest(client, userId, {
        orgId: body.orgId,
        requestId: body.requestId,
        decision: body.decision,
        role: body.role,
      }),
    );
    return privateJson({ reviewed });
  } catch (error) {
    return securityErrorResponse(error, "Could not review access request.");
  }
}
