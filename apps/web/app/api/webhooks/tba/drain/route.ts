import { assertCronAuthorized } from "../../../../../lib/reference/run-ingest";
import { drainTbaWebhookEvents } from "../../../../../lib/webhooks/tba-fanout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Catch-up pass for TBA deliveries whose fan-out did not finish inside the webhook
 * request (cold stop, transient DB error, push service timeout). Claims pending rows
 * with `FOR UPDATE SKIP LOCKED` so it can safely overlap a live webhook.
 *
 * CRON_SECRET-guarded, same as every other worker route. Register it on whatever
 * ticker you use — a few minutes apart is plenty; the webhook is the fast path and
 * this is only the safety net.
 */
export async function GET(request: Request) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  return run(request);
}

export async function POST(request: Request) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  return run(request);
}

async function run(request: Request) {
  const limitParam = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : 25;
  try {
    const summary = await drainTbaWebhookEvents({ limit });
    return Response.json({ ok: true, summary });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "TBA webhook drain failed" },
      { status: 500 },
    );
  }
}
