import {
  auth,
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
  if (!session) return privateJson({ authenticated: false }, { status: 401 });
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

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const ipPart = anonymizeIp(clientIp(request));
  try {
    const body = await parseSecureJson(request, actionSchema, { maxBytes: 1_024 });
    if (body.action === "request") {
      if (!(await requestLimiter.allow(`${session.user.id}:${ipPart}`))) {
        return rateLimitedResponse("Too many verification emails. Wait a minute and try again.");
      }
      const result = await requestEmail2faCode({
        sessionId: session.session.id,
        userId: session.user.id,
        email: session.user.email,
      });
      return privateJson(result);
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
