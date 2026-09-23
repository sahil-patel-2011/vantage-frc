import { RecoveryEmailError, auth, requestRecoverySignIn, verifyRecoverySignIn } from "@vantage/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../lib/rate-limit";

const limiter = createRateLimiter({ limit: 10, windowMs: 10 * 60_000, namespace: "recovery-signin" });

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send"), email: z.string().max(254) }),
  z.object({ action: z.literal("verify"), email: z.string().max(254), code: z.string().max(12) }),
]);

const noStore = { "Cache-Control": "private, no-store" };

/**
 * POST /api/recovery — sign in with a recovery email (packages/core/src/recovery-email.ts).
 *   { action: "send", email }          → always { ok: true }; only a real recovery address gets a code
 *   { action: "verify", email, code }  → sets the session cookie, like an emailed sign-in code
 * Public: this is how someone who cannot reach their main mailbox gets back in.
 */
export async function POST(request: Request) {
  if (!(await limiter.allow(anonymizeIp(clientIp(request), "recovery")))) {
    return rateLimitedResponse("Too many tries. Wait a few minutes and try again.");
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your recovery email." }, { status: 400, headers: noStore });

  try {
    if (parsed.data.action === "send") {
      await requestRecoverySignIn({ email: parsed.data.email });
      return NextResponse.json({ ok: true }, { headers: noStore });
    }
    const { userId } = await verifyRecoverySignIn({ email: parsed.data.email, code: parsed.data.code });
    // A code sent to a mailbox the person proved they own: the same standing as an
    // emailed sign-in code, second factor included.
    const minted = await auth.api.createProductHandoffSession({
      body: { userId, authMethod: "email_otp", email2faVerifiedAt: new Date().toISOString() },
      headers: request.headers,
      returnHeaders: true,
    });
    const response = NextResponse.json({ ok: true }, { headers: noStore });
    for (const cookie of minted.headers.getSetCookie()) response.headers.append("Set-Cookie", cookie);
    return response;
  } catch (error) {
    if (error instanceof RecoveryEmailError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: noStore });
    }
    console.error("[recovery-signin]", error instanceof Error ? error.name : typeof error);
    return NextResponse.json({ error: "Something went wrong. Try again in a minute." }, { status: 500, headers: noStore });
  }
}
