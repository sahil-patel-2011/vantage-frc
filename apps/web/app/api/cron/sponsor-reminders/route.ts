import { assertCronAuthorized } from "../../../../lib/reference/run-ingest";
import { runSponsorReminders } from "../../../../lib/run-sponsor-reminders";
import { publicErrorMessage } from "../../../../lib/security/public-error";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Daily thank-you / renewal / overdue follow-up sponsor CRM nudges.
 * In-app inbox for owners/admins (pref default ON) + opt-in Resend email
 * (`sponsor_reminders`, default OFF). Never emails external sponsors.
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
    const summary = await runSponsorReminders();
    return Response.json({ ok: true, summary });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: publicErrorMessage(error, "Sponsor reminders failed"),
      },
      { status: 500 },
    );
  }
}
