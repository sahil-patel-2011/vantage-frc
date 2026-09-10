import { NextResponse } from "next/server";
import { constructStripeEvent, isStripeNotConfigured, processStripeEvent } from "@vantage/billing";
import { getBillingPool } from "@vantage/db/billing";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event;
  try {
    event = constructStripeEvent(await request.text(), signature);
  } catch (error) {
    // A deployment with no Stripe credentials used to answer "Invalid webhook"
    // with a 400 — the same body and status as a genuine signature mismatch. In
    // the Stripe dashboard those are indistinguishable, so an operator who had
    // created the endpoint but never set STRIPE_WEBHOOK_SECRET spends the
    // afternoon regenerating a signing secret that was never the problem. 503
    // names the variables, and Stripe retries a 503 (it does not retry a 400),
    // so the events that arrive while someone sets them are not lost.
    if (isStripeNotConfigured(error)) {
      return NextResponse.json({ error: error.message, missingEnv: error.missingEnv }, { status: 503 });
    }
    // A real signature failure stays deliberately opaque: this endpoint is
    // public, and a detailed error is a probing oracle.
    return NextResponse.json({ error: "Invalid webhook" }, { status: 400 });
  }

  const client = await getBillingPool().connect();
  try {
    await client.query("BEGIN");
    const result = await processStripeEvent(client, event);
    await client.query("COMMIT");
    return NextResponse.json({ received: true, duplicate: result.duplicate });
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    // The payload was already proven to come from Stripe, so a failure here is
    // ours — a database blip, a missing plan row. It used to return 400, which
    // Stripe treats as "delivered, do not retry": a subscription activation lost
    // to a transient error, and an org left un-entitled after a real payment.
    // 500 is retried.
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
