import { assertCronAuthorized } from "../../../../lib/reference/run-ingest";
import { purgeExpiredProductEvents, RAW_EVENT_RETENTION_DAYS } from "../../../../lib/product-analytics/retention";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * The 180-day purge of raw product events, as an endpoint a scheduler can hit.
 *
 *   curl -X POST https://<host>/api/analytics/retention \
 *        -H "Authorization: Bearer $CRON_SECRET"
 *
 * Run it daily. It deletes every `product_events` row older than the retention
 * window across all teams, under the worker role — the request role cannot and
 * should not be able to reach across orgs.
 *
 * GET is supported because several schedulers only issue GETs; both verbs
 * require the same CRON_SECRET, and neither is reachable from a browser session.
 */

async function run() {
  try {
    const summary = await purgeExpiredProductEvents();
    return Response.json({ ok: true, summary });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        retentionDays: RAW_EVENT_RETENTION_DAYS,
        error: error instanceof Error ? error.message : "Product analytics retention purge failed",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  return run();
}

export async function POST(request: Request) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  return run();
}
