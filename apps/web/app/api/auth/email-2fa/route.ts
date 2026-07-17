import {
  auth,
  isEmail2faEnforced,
  requestEmail2faCode,
  sessionHasEmail2fa,
  verifyEmail2faCode,
} from "@vantage/core";
import { headers } from "next/headers";
import {
  anonymizeIp,
  clientIp,
  createRateLimiter,
  rateLimitedResponse,
} from "../../../../lib/rate-limit";

const requestLimiter = createRateLimiter({ limit: 8, windowMs: 60_000, namespace: "email-2fa-request" });
const verifyLimiter = createRateLimiter({ limit: 20, windowMs: 60_000, namespace: "email-2fa-verify" });

async function currentSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function GET() {
  const session = await currentSession();
  if (!session) return Response.json({ authenticated: false }, { status: 401 });
  const enforced = isEmail2faEnforced();
  const verified = sessionHasEmail2fa(session.session as { email2faVerifiedAt?: Date | string | null });
  return Response.json({
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

  const body = (await request.json().catch(() => ({}))) as { action?: string; code?: string };
  const ipPart = anonymizeIp(clientIp(request));
  try {
    if (body.action === "request") {
      if (!(await requestLimiter.allow(`${session.user.id}:${ipPart}`))) {
        return rateLimitedResponse("Too many verification emails. Wait a minute and try again.");
      }
      const result = await requestEmail2faCode({
        sessionId: session.session.id,
        userId: session.user.id,
        email: session.user.email,
      });
      return Response.json(result);
    }
    if (body.action === "verify") {
      if (!(await verifyLimiter.allow(`${session.user.id}:${ipPart}`))) {
        return rateLimitedResponse("Too many verification attempts. Wait a minute and try again.");
      }
      const result = await verifyEmail2faCode({
        sessionId: session.session.id,
        userId: session.user.id,
        email: session.user.email,
        code: String(body.code ?? ""),
      });
      return Response.json(result);
    }
    return Response.json({ error: "Invalid action." }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Email verification failed." },
      { status: 400 },
    );
  }
}
