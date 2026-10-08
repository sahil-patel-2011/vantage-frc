import { auth, isInviteTokenShape, peekOrganizationInvite } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import { createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";
import { parseSecureJson, RequestSecurityError, securityErrorResponse } from "../../../../lib/security/request";

const limiter = createRateLimiter({ limit: 5, windowMs: 10 * 60_000, namespace: "invite-password" });
const bodySchema = z.object({
  token: z.string().trim().refine(isInviteTokenShape),
  password: z.string().min(12).max(128),
}).strict();

function privateJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "private, no-store, max-age=0" } });
}

/** The invite names a team; a verified, fresh auth session proves the recipient's identity. */
export async function POST(request: Request) {
  try {
    const requestHeaders = await headers();
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (!session) return privateJson({ error: "Sign in with your invited email first." }, 401);
    if (!session.user.emailVerified) return privateJson({ error: "Verify your invited email before setting a password." }, 403);
    const body = await parseSecureJson(request, bodySchema, { maxBytes: 4096 });
    if (!(await limiter.allow(session.user.id))) return rateLimitedResponse("Too many password attempts. Wait a few minutes and try again.");
    await withRls({ userId: session.user.id }, async client => {
      const invite = await peekOrganizationInvite(client, body.token);
      if (!invite || invite.status !== "pending" || !Number.isFinite(Date.parse(invite.expiresAt)) || Date.parse(invite.expiresAt) <= Date.now()) {
        throw new RequestSecurityError(410, "This invitation has expired or is no longer available. Ask your team admin for a new link.");
      }
      if (invite.email.trim().toLowerCase() !== session.user.email.trim().toLowerCase()) {
        throw new RequestSecurityError(403, "This invitation belongs to a different email address.");
      }
    });
    const linkedAccounts = await auth.api.listUserAccounts({ headers: requestHeaders });
    // A retry after a lost response must never overwrite an existing credential.
    if (linkedAccounts.some(account => account.providerId === "credential")) return privateJson({ passwordSet: true, alreadySet: true });
    const result = await auth.api.setPassword({ headers: requestHeaders, body: { newPassword: body.password } });
    if (!result.status) throw new Error("Password setup was not acknowledged");
    return privateJson({ passwordSet: true });
  } catch (error) {
    if (error instanceof RequestSecurityError) return securityErrorResponse(error, "Could not set your password.");
    const status = error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : 0;
    if (status === 401 || status === 403) return privateJson({ error: "Sign in again with the invited email, then return to this link." }, status);
    // Do not send provider internals or database errors to the password screen.
    return privateJson({ error: "Could not set your password. Try again, or continue with an email code." }, status === 400 ? 400 : 503);
  }
}
