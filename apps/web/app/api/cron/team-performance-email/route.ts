import { assertCronAuthorized } from "../../../../lib/reference/run-ingest";
import { runPerformanceEmail } from "../../../../lib/performance-email/run-performance-email";

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Daily team performance email — see docs/PERFORMANCE_EMAIL.md.
 * Worker-only (vantage_worker admin pool); auth via CRON_SECRET bearer or
 * x-cron-secret header like the other crons. Only orgs with real data today
 * (scored matches or scouting activity) send anything; the default-ON
 * `performance_digest` category and performance_email_log make delivery
 * per-member opt-out and re-run safe. `?orgId=` runs a single org for
 * testing. The response is counts only — never member emails or org content.
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
    const orgId = new URL(request.url).searchParams.get("orgId") ?? undefined;
    if (orgId && !UUID_PATTERN.test(orgId)) {
      return Response.json({ error: "orgId must be a UUID" }, { status: 400 });
    }
    const summary = await runPerformanceEmail({ orgId });
    return Response.json({ ok: true, summary: { ...summary, errors: summary.errors.length } });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Performance email run failed",
      },
      { status: 500 },
    );
  }
}
