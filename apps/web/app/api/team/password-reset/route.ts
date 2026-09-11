import {
  auditMemberPasswordReset,
  auth,
  isEmailProviderConfigured,
  resolveMemberForPasswordReset,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import { createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";
import { parseSecureJson, securityErrorResponse } from "../../../../lib/security/request";

// 5 resets per 10 minutes per admin — keyed by the acting admin, not by IP.
const resetLimiter = createRateLimiter({ limit: 5, windowMs: 10 * 60_000, namespace: "team-password-reset" });

const resetSchema = z
  .object({
    orgId: z.string().uuid(),
    userId: z.string().uuid(),
  })
  .strict();

function privateJson(value: unknown, init?: ResponseInit) {
  const response = Response.json(value, init);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  return response;
}

/**
 * Owner/admin-initiated password reset for a member of their workspace.
 * Never sets a password: it triggers Better Auth's own forgot-password email
 * (the exact flow /signin uses), so only the mailbox owner can complete it.
 * Better Auth revokes the target's sessions when the reset completes
 * (`revokeSessionsOnPasswordReset`).
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return privateJson({ error: "Authentication required" }, { status: 401 });
  const actorUserId = session.user.id;

  try {
    if (!(await resetLimiter.allow(actorUserId))) {
      return rateLimitedResponse("Too many password resets. Wait a few minutes and try again.");
    }
    const body = await parseSecureJson(request, resetSchema);

    if (!isEmailProviderConfigured()) {
      return privateJson(
        {
          error:
            "Password reset emails are unavailable until email sending is configured.",
          setupRequired: true,
        },
        { status: 503 },
      );
    }

    // Authorization + target resolution under the admin's RLS context.
    const target = await withRls({ userId: actorUserId, orgId: body.orgId }, (client) =>
      resolveMemberForPasswordReset(client, actorUserId, { orgId: body.orgId, userId: body.userId }),
    );

    // Same server-side path as the /signin "Forgot password?" flow.
    let delivered = false;
    let deliveryError: string | null = null;
    try {
      await auth.api.requestPasswordResetEmailOTP({ body: { email: target.email } });
      delivered = true;
    } catch (error) {
      deliveryError = error instanceof Error ? error.message : "Reset email could not be sent";
    }

    // Traceable even when delivery failed.
    await withRls({ userId: actorUserId, orgId: body.orgId }, (client) =>
      auditMemberPasswordReset(client, actorUserId, {
        orgId: body.orgId,
        targetUserId: target.userId,
        email: target.email,
        delivered,
      }),
    );

    if (!delivered) {
      return privateJson({ error: deliveryError ?? "Reset email could not be sent" }, { status: 502 });
    }
    // Note: no immediate session-revocation helper exists in @vantage/core;
    // sessions are revoked by Better Auth when the target completes the reset.
    return privateJson({ ok: true, email: target.email });
  } catch (error) {
    return securityErrorResponse(error, "Could not send the password reset email.");
  }
}
