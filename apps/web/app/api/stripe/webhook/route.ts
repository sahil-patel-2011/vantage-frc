import { NextResponse } from "next/server";
import { constructStripeEvent, processStripeEvent } from "@vantage/billing";
import { getBillingPool } from "@vantage/db/billing";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  try {
    const event = constructStripeEvent(await request.text(), signature);
    const client = await getBillingPool().connect();
    try {
      await client.query("BEGIN");
      const result = await processStripeEvent(client, event);
      await client.query("COMMIT");
      return NextResponse.json({ received: true, duplicate: result.duplicate });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch {
    return NextResponse.json({ error: "Invalid webhook" }, { status: 400 });
  }
}
