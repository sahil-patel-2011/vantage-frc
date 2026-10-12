import {
  auth,
  Email2faDeliveryError,
  isEmail2faEnforced,
  requestEmail2faCode,
  sessionHasEmail2fa,
  verifyEmail2faCode,
} from "@vantage/core";
import { headers } from "next/headers";
import { z } from "zod";
import {
  anonymizeIp,
  clientIp,
  createRateLimiter,
  rateLimitedResponse,
} from "../../../../lib/rate-limit";
import { parseSecureJson, securityErrorResponse } from "../../../../lib/security/request";

const requestLimiter = createRateLimiter({ limit: 8, windowMs: 60_000, namespace: "email-2fa-request" });
const verifyLimiter = createRateLimiter({ limit: 20, windowMs: 60_000, namespace: "email-2fa-verify" });
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request") }).strict(),
  z.object({ action: z.literal("verify"), code: z.string().regex(/^\d{6}$/) }).strict(),
]);

function privateJson(value: unknown, init?: ResponseInit) {
  const response = Response.json(value, init);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  return response;
}

async function currentSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function GET() {
  const session = await currentSession();
  // Signed out is an ordinary answer for this read-only probe, not an error: /signin asks on
  // every visit, and a 401 there logged a red console error before anyone typed anything.
  if (!session) return privateJson({ authenticated: false });
  const enforced = isEmail2faEnforced();
  const verified = sessionHasEmail2fa(session.session as { email2faVerifiedAt?: Date | string | null });
  return privateJson({
    authenticated: true,
    email2faEnforced: enforced,
    email2faVerified: verified || !enforced,
    requiresVerification: enforced && !verified,
    emailHint: session.user.email.replace(/(^.).*(@.*$)/, "$1***$2"),
  });
}

/**
 * A failed send is never a 400: the sign-in screen reads a 400 as a wrong code, and nobody has
 * typed one yet. It is Vantage's side, so a 503.
 */
function sendFailureResponse(error: unknown) {
  // The address and code stay out of the log; the error's name and database code say enough.
  const name = error instanceof Error ? error.name : "unknown";
  const cause = error instanceof Email2faDeliveryError ? error.causeName : "";
  const databaseCode =
    error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  console.error(`[email-2fa] send failed: ${name}${cause ? ` (${cause})` : ""}${databaseCode ? ` db=${databaseCode}` : ""}`);
  return privateJson(
    { error: "We couldn't send your code. Wait a minute, then tap Send a new code.", code: "SEND_FAILED" },
    { status: 503 },
  );
}

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });

  const ipPart = anonymizeIp(clientIp(request));
  try {
    const body = await parseSecureJson(request, actionSchema, { maxBytes: 1_024 });
    if (body.action === "request") {
      if (!(await requestLimiter.allow(`${session.user.id}:${ipPart}`))) {
        return rateLimitedResponse("Too many verification emails. Wait a minute and try again.");
      }
      try {
        const result = await requestEmail2faCode({
          sessionId: session.session.id,
          userId: session.user.id,
          email: session.user.email,
        });
        return privateJson(result);
      } catch (error) {
        return sendFailureResponse(error);
      }
    }
    if (body.action === "verify") {
      if (!(await verifyLimiter.allow(`${session.user.id}:${ipPart}`))) {
        return rateLimitedResponse("Too many verification attempts. Wait a minute and try again.");
      }
      const result = await verifyEmail2faCode({
        sessionId: session.session.id,
        userId: session.user.id,
        email: session.user.email,
        code: body.code,
      });
      return privateJson(result);
    }
    return privateJson({ error: "Invalid action." }, { status: 400 });
  } catch (error) {
    return securityErrorResponse(error, "Email verification failed.");
  }
}
