import { parseRecoveryRequest, recoveryMail } from "../../../lib/account-recovery/request";
import { mailFeedbackInbox } from "../../../lib/feedback/inbox-mail";
import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../lib/rate-limit";

export const dynamic = "force-dynamic";

/** Public (the person can't sign in), so it is rate limited per network. */
const limiter = createRateLimiter({ limit: 3, windowMs: 60 * 60_000, namespace: "account-recovery" });

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "private, no-store" } });
}

/**
 * Account recovery request: emailed to the Vantage inboxes for a person to review. Nothing is
 * reset, unlocked or stored in the database; the old password, if given, only travels in that
 * email and is never logged.
 */
export async function POST(request: Request) {
  const network = anonymizeIp(clientIp(request));
  if (!(await limiter.allow(network))) {
    return rateLimitedResponse("You've sent a few requests already. Try again in an hour.");
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "We couldn't read that form. Try again." }, 400);
  }
  // A filled hidden field is a bot: answer as if it worked and send nothing.
  if (typeof body.website === "string" && body.website.trim()) return json({ ok: true });

  const parsed = parseRecoveryRequest(body);
  if (!parsed.ok) return json({ error: parsed.error, field: parsed.field }, 400);

  const mail = recoveryMail(parsed.request, { ip: network, at: new Date() });
  const result = await mailFeedbackInbox(mail);
  if (result !== "sent") {
    return json({ error: "We couldn't send your request just now. Try again in a few minutes." }, 503);
  }
  return json({ ok: true });
}
