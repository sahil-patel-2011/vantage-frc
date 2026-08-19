import { runSeasonCronPiggybacks } from "../../../../lib/reference/season-cron-piggybacks";
import { notifyMatchScheduleAfterSync } from "../../../../lib/reference/notify-schedule";
import {
  assertCronAuthorized,
  runNexusEventSync,
  runTbaEventDaySync,
  runTbaSeasonSync,
} from "../../../../lib/reference/run-ingest";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Vercel cron / webhook-style TBA refresh.
 * Hobby plan: two daily crons in vercel.json (event-day 14:00 UTC, season 06:00 UTC).
 * Season mode piggybacks sponsor reminders, product releases, and research sweep.
 * Pro / external tickers may call ?mode=event-day more often, or /api/cron/research-sweep.
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
          const matchAlerts = await notifyMatchScheduleAfterSync(summary.eventKeys ?? []);
          const piggybacks = await runSeasonCronPiggybacks();
          return Response.json({ ok: true, summary, matchAlerts, ...piggybacks });
        }
        const summary = await runTbaEventDaySync({
          year: body.year ?? year,
          eventKeys,
        });
        const matchAlerts = await notifyMatchScheduleAfterSync(summary.eventKeys ?? []);
        const nexus = await runNexusEventSync(summary.eventKeys ?? []);
        return Response.json({ ok: true, summary, matchAlerts, nexus });
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
      const matchAlerts = await notifyMatchScheduleAfterSync(summary.eventKeys ?? []);
      const piggybacks = await runSeasonCronPiggybacks();
      return Response.json({ ok: true, summary, matchAlerts, ...piggybacks });
    }

    const eventKey = url.searchParams.get("eventKey");
    const summary = await runTbaEventDaySync({
      year,
      eventKeys: eventKey ? [eventKey] : undefined,
    });
    const matchAlerts = await notifyMatchScheduleAfterSync(summary.eventKeys ?? []);
    const nexus = await runNexusEventSync(summary.eventKeys ?? []);
    return Response.json({ ok: true, summary, matchAlerts, nexus });
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