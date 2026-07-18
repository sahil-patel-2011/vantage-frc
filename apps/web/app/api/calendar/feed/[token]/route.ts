import { requestPool } from "@vantage/db";
import { buildCalendar, type CalendarIcsFeed } from "../../../../../lib/calendar-ics";

/**
 * Public, unauthenticated calendar subscription feed (.ics).
 * Authorized solely by the opaque per-member token in the path
 * (see isPublicCalendarFeed in proxy.ts). get_calendar_feed only returns
 * rows allowed by that token's scope, and NULL for unknown tokens —
 * there is no unauthenticated dump of org calendars.
 */
export const dynamic = "force-dynamic";

function notFound() {
  return new Response("Calendar feed not found.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(token)) return notFound();

  try {
    const result = await requestPool.query<{ feed: CalendarIcsFeed | null }>(
      "SELECT get_calendar_feed($1) AS feed",
      [token],
    );
    const feed = result.rows[0]?.feed;
    if (!feed) return notFound();

    const host = (() => {
      try {
        return new URL(request.url).host || "vantagefrc.com";
      } catch {
        return "vantagefrc.com";
      }
    })();

    const ics = buildCalendar(feed, { domain: host });
    return new Response(ics, {
      status: 200,
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": 'inline; filename="vantage-calendar.ics"',
        // Calendar clients poll periodically; a few minutes of cache is plenty.
        // Private: the URL is a capability token — do not put on shared CDNs.
        "cache-control": "private, max-age=300",
      },
    });
  } catch {
    return notFound();
  }
}
