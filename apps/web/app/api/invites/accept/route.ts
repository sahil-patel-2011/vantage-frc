import {
  acceptOrganizationInvite,
  assertTermsAccepted,
  auth,
  peekOrganizationInvite,
  recordLegalAcceptance,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import { inviteTermsRequired } from "../../../../lib/invite";
import {
  anonymizeIp,
  clientIp,
  createRateLimiter,
  rateLimitedResponse,
} from "../../../../lib/rate-limit";
import { parseSecureJson, securityErrorResponse } from "../../../../lib/security/request";

const limiter = createRateLimiter({ limit: 20, windowMs: 10 * 60_000, namespace: "invite-accept" });
const acceptSchema = z
  .object({
    token: z.string().trim().length(43).regex(/^[A-Za-z0-9_-]+$/),
    /** Required when the account has not yet accepted Terms/Privacy. */
    termsAccepted: z.boolean().optional(),
  })
  .strict();

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
    const orgId = await withRls({ userId: session.user.id }, async (client) => {
      // Exact-email gate before SECURITY DEFINER accept (clear Soft-UI error; SQL still enforces).
      const preview = await peekOrganizationInvite(client, body.token);
      if (!preview) {
        throw new Error("Invite is invalid or already used");
      }
      const sessionEmail = session.user.email?.trim().toLowerCase() ?? "";
      if (!sessionEmail || preview.email.trim().toLowerCase() !== sessionEmail) {
        const err = new Error("This invite was sent to a different email address.");
        (err as Error & { status?: number }).status = 403;
        throw err;
      }
      if (preview.status !== "pending") {
        throw new Error(
          preview.status === "expired" ? "Invite has expired" : "Invite is invalid or already used",
        );
      }

      const terms = await client.query<{ termsAcceptedAt: string | null }>(
        `SELECT terms_accepted_at::text AS "termsAcceptedAt"
         FROM profiles WHERE user_id = $1::uuid`,
        [session.user.id],
      );
      const required = inviteTermsRequired(terms.rows[0]?.termsAcceptedAt ?? null);
      if (required) {
        assertTermsAccepted(body.termsAccepted === true);
        await recordLegalAcceptance(client, session.user.id);
      } else if (body.termsAccepted === true) {
        await recordLegalAcceptance(client, session.user.id);
      }

      return acceptOrganizationInvite(client, session.user.id, body.token);
    });
    return privateJson({ orgId });
  } catch (error) {
    if (error instanceof Error && (error as Error & { status?: number }).status === 403) {
      return privateJson({ error: error.message }, { status: 403 });
    }
    return securityErrorResponse(error, "Invite could not be accepted");
  }
}
