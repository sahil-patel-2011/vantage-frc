import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import { parseSecureJson, RequestSecurityError, securityErrorResponse } from "../../../../lib/security/request";
import { createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";

const bodySchema = z.object({ orgId: z.string().uuid() }).strict();
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000, namespace: "team-leave" });
const privateJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return privateJson({ error: "Sign in before leaving a team." }, 401);
    const { orgId } = await parseSecureJson(request, bodySchema, { maxBytes: 4096 });
    if (!(await limiter.allow(session.user.id))) return rateLimitedResponse("Wait a moment before trying again.");
    const outcome = await withRls({ userId: session.user.id, orgId }, async client => {
      const result = await client.query<{ outcome: string }>("SELECT public.leave_my_team($1::uuid) AS outcome", [orgId]);
      return result.rows[0]?.outcome;
    });
    if (outcome === "owner_required") return privateJson({ error: "Hand over ownership in Team admin before leaving this team." }, 409);
    if (outcome === "last_admin") return privateJson({ error: "Choose another team administrator before leaving." }, 409);
    if (outcome !== "left" && outcome !== "already_left") throw new Error("Team departure was not confirmed.");
    return privateJson({ left: true, orgId, alreadyLeft: outcome === "already_left" });
  } catch (error) {
    if (error instanceof RequestSecurityError) return securityErrorResponse(error, "Could not leave this team.");
    return privateJson({ error: "Could not confirm leaving this team. Refresh your teams before trying again." }, 503);
  }
}
