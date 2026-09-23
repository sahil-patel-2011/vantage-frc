import {
  RecoveryEmailError,
  auth,
  confirmRecoveryEmailChange,
  getRecoveryEmail,
  isEmailDeliveryConfigured,
  removeRecoveryEmail,
  startRecoveryEmailChange,
} from "@vantage/core";
import { headers } from "next/headers";
import { z } from "zod";
import { createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";

const limiter = createRateLimiter({ limit: 12, windowMs: 10 * 60_000, namespace: "recovery-email-settings" });

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send"), email: z.string().max(254) }),
  z.object({ action: z.literal("confirm"), code: z.string().max(12) }),
]);

const noStore = { "Cache-Control": "private, no-store" };

function fail(error: unknown) {
  if (error instanceof RecoveryEmailError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  console.error("[recovery-email]", error instanceof Error ? error.name : typeof error);
  return Response.json({ error: "Something went wrong. Try again in a minute." }, { status: 500, headers: noStore });
}

async function signedIn() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session ? { userId: session.user.id, primaryEmail: session.user.email } : null;
}

/** GET /api/account/recovery-email — the signed-in person's recovery email, if any. */
export async function GET() {
  const me = await signedIn();
  if (!me) return Response.json({ error: "Sign in first." }, { status: 401, headers: noStore });
  try {
    // Codes need a mail service in production; locally they land in the dev mailbox.
    const available = process.env.NODE_ENV !== "production" || isEmailDeliveryConfigured();
    return Response.json({ recovery: await getRecoveryEmail(me.userId), available }, { headers: noStore });
  } catch (error) {
    return fail(error);
  }
}

/** POST { action: "send", email } then { action: "confirm", code }. */
export async function POST(request: Request) {
  const me = await signedIn();
  if (!me) return Response.json({ error: "Sign in first." }, { status: 401, headers: noStore });
  if (!(await limiter.allow(me.userId))) return rateLimitedResponse("Too many tries. Wait a few minutes and try again.");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter an email address." }, { status: 400, headers: noStore });
  try {
    const result =
      parsed.data.action === "send"
        ? await startRecoveryEmailChange({ ...me, email: parsed.data.email })
        : await confirmRecoveryEmailChange({ ...me, code: parsed.data.code });
    return Response.json({ ok: true, email: result.email }, { headers: noStore });
  } catch (error) {
    return fail(error);
  }
}

/** DELETE — remove the recovery email. */
export async function DELETE() {
  const me = await signedIn();
  if (!me) return Response.json({ error: "Sign in first." }, { status: 401, headers: noStore });
  try {
    return Response.json({ ok: true, ...(await removeRecoveryEmail(me)) }, { headers: noStore });
  } catch (error) {
    return fail(error);
  }
}
