import {
  assertCronAuthorized,
  runTbaEventDaySync,
  runTbaSeasonSync,
} from "../../../../lib/reference/run-ingest";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Vercel cron / webhook-style TBA refresh.
 * - Default: incremental event-day sync (active ±1 day + subscribed events)
 * - ?mode=season&year=2026: full season ingest
 * - body/query eventKey: force refresh one event
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
  try {
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") ?? "event-day";
    const yearParam = url.searchParams.get("year");
    const year = yearParam ? Number(yearParam) : undefined;
    let eventKeys: string[] | undefined;

    if (request.method === "POST") {
      try {
        const body = (await request.json()) as {
          mode?: string;
          year?: number;
          eventKey?: string;
          eventKeys?: string[];
        };
        if (body.eventKey) eventKeys = [body.eventKey];
        if (body.eventKeys?.length) eventKeys = body.eventKeys;
        const effectiveMode = body.mode ?? mode;
        if (effectiveMode === "season") {
          const summary = await runTbaSeasonSync(body.year ?? year);
          return Response.json({ ok: true, summary });
        }
        const summary = await runTbaEventDaySync({
          year: body.year ?? year,
          eventKeys,
        });
        return Response.json({ ok: true, summary });
      } catch (error) {
        if (error instanceof SyntaxError) {
          // empty body — fall through to query params
        } else {
          throw error;
        }
      }
    }

    if (mode === "season") {
      const summary = await runTbaSeasonSync(year);
      return Response.json({ ok: true, summary });
    }

    const eventKey = url.searchParams.get("eventKey");
    const summary = await runTbaEventDaySync({
      year,
      eventKeys: eventKey ? [eventKey] : undefined,
    });
    return Response.json({ ok: true, summary });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "TBA sync failed",
      },
      { status: 500 },
    );
  }
}
