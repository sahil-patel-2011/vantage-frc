import { assertCronAuthorized } from "../../../../lib/reference/run-ingest";
import { runGrantDeadlineAlerts } from "../../../../lib/grants-calendar/run-grant-deadline-alerts";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Daily grant deadline alerts at 30 / 14 / 3 days before a watched grant closes.
 * In-app inbox row for the watcher (honors their in-app prefs) + opt-in Resend email on the
 * existing `sponsor_reminders` category with the standard unsubscribe footer.
 * Fires once per (org, grant, member, milestone, close date) — see migration 0458.
 */
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

async function run() {
  try {
    const summary = await runGrantDeadlineAlerts();
    return Response.json({ ok: true, summary });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Grant deadline alerts failed",
      },
      { status: 500 },
    );
  }
}
