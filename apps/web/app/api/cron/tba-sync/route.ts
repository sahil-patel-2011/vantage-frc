import {
  assertCronAuthorized,
  runTbaEventDaySync,
  runTbaSeasonSync,
} from "../../../../lib/reference/run-ingest";
import { notifyMatchScheduleAfterSync } from "../../../../lib/reference/notify-schedule";
import { runSponsorReminders } from "../../../../lib/run-sponsor-reminders";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Vercel cron / webhook-style TBA refresh.
 * - Default: incremental event-day sync (active ±1 day + subscribed events)
 * - ?mode=season&year=2026: full season ingest
 * - body/query eventKey: force refresh one event
 * After a successful sync, emit_match_schedule_alerts fans out match_alert rows
 * when our team's schedule fingerprint changes (My Day).
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
          // Hobby allows 2 crons — piggyback daily sponsor reminders on season sync.
          const sponsorReminders = await runSponsorReminders();
          return Response.json({ ok: true, summary, matchAlerts, sponsorReminders });
        }
        const summary = await runTbaEventDaySync({
          year: body.year ?? year,
          eventKeys,
        });
        const matchAlerts = await notifyMatchScheduleAfterSync(summary.eventKeys ?? []);
        return Response.json({ ok: true, summary, matchAlerts });
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
      // Hobby allows 2 crons — piggyback daily sponsor reminders on season sync.
      const sponsorReminders = await runSponsorReminders();
      return Response.json({ ok: true, summary, matchAlerts, sponsorReminders });
    }

    const eventKey = url.searchParams.get("eventKey");
    const summary = await runTbaEventDaySync({
      year,
      eventKeys: eventKey ? [eventKey] : undefined,
    });
    const matchAlerts = await notifyMatchScheduleAfterSync(summary.eventKeys ?? []);
    return Response.json({ ok: true, summary, matchAlerts });
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