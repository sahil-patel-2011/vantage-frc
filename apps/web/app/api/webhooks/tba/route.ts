import { after } from "next/server";
import {
  drainTbaWebhookEvents,
  recordTbaEvent,
  withWebhookWorker,
} from "../../../../lib/webhooks/tba-fanout";
import { parseTbaEnvelope, readVerificationKey } from "../../../../lib/webhooks/tba-messages";
import { tbaWebhookSecret, verifyTbaWebhook } from "../../../../lib/webhooks/tba-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The Blue Alliance Firehose intake.
 *
 * TBA gives the endpoint TEN SECONDS to answer and retries/disables endpoints that
 * time out, so this handler does the minimum: verify the HMAC over the raw body,
 * write the delivery to `tba_webhook_events`, answer 200. Fan-out (which touches many
 * orgs and makes outbound push requests) runs after the response via `after()`, and
 * anything that did not finish is retried by `/api/webhooks/tba/drain` on the cron.
 *
 * Registration is account-bound in the TBA web UI — see docs/PUSH_NOTIFICATIONS.md.
 * One platform-level subscription serves every team; we fan out by org internally.
 */
export async function POST(request: Request) {
  // The HMAC is over the exact bytes TBA sent: read text BEFORE any JSON.parse.
  const rawBody = await request.text();
  const verification = verifyTbaWebhook({
    rawBody,
    header: request.headers.get("x-tba-hmac"),
    secret: tbaWebhookSecret(),
  });
  if (!verification.ok) {
    return Response.json({ error: verification.reason }, { status: verification.status });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Body is not valid JSON" }, { status: 400 });
  }

  const envelope = parseTbaEnvelope(parsed);
  if (!envelope) {
    return Response.json({ error: "Expected { message_type, message_data }" }, { status: 400 });
  }

  // The one-time handshake. TBA shows a code on the account page and posts the same code
  // here; an operator reads it out of the deploy logs and types it back. Nothing is stored.
  if (envelope.messageType === "verification") {
    const key = readVerificationKey(envelope);
    console.info(
      `[tba-webhook] VERIFICATION CODE: ${key ?? "(missing verification_key in payload)"} — paste this into thebluealliance.com/account to confirm the webhook.`,
    );
    return Response.json({ ok: true, message_type: "verification", verification_key: key });
  }

  // `ping` is the "test this endpoint" button in the TBA account UI. Answer instantly.
  if (envelope.messageType === "ping") {
    console.info("[tba-webhook] ping received");
    return Response.json({ ok: true, message_type: "ping" });
  }

  let eventId: string;
  try {
    eventId = (await withWebhookWorker((client) => recordTbaEvent(client, envelope))).id;
  } catch (error) {
    // Never 500 at TBA: a non-2xx here counts against the endpoint's health. Log and move on.
    console.error(
      `[tba-webhook] could not record ${envelope.messageType}:`,
      error instanceof Error ? error.message : error,
    );
    return Response.json({ ok: true, recorded: false, message_type: envelope.messageType });
  }

  const queuedId = eventId;
  after(async () => {
    try {
      const summary = await drainTbaWebhookEvents({ id: queuedId, limit: 1 });
      if (summary.errors.length > 0) {
        console.error(`[tba-webhook] fan-out errors: ${summary.errors.join("; ")}`);
      }
    } catch (error) {
      // Left pending on purpose — the drain cron picks it up on the next pass.
      console.error(
        "[tba-webhook] deferred fan-out failed:",
        error instanceof Error ? error.message : error,
      );
    }
  });

  return Response.json({ ok: true, recorded: true, message_type: envelope.messageType });
}
