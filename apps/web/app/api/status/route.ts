import { cachedPublicStatus } from "../../../lib/outage/notice";
import { getOutageStore } from "../../../lib/outage/status-store";

export const dynamic = "force-dynamic";

/**
 * Public: is Vantage running with limited features right now? `{ limited, message?, since? }`.
 *
 * Reads only the outage store, never the database, so it answers while the database is down —
 * that is when the app needs it. Cached for up to 30 s at the edge and 10 s in this instance.
 */
export async function GET() {
  const status = await cachedPublicStatus(getOutageStore());
  return Response.json(status, {
    headers: { "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=30" },
  });
}
