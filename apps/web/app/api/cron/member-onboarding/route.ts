import { assertCronAuthorized } from "../../../../lib/reference/run-ingest";
import { runMemberOnboarding } from "../../../../lib/member-onboarding/run-member-onboarding";

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * New-member onboarding sequence.
 *
 * Worker-only (vantage_worker admin pool); authorised by CRON_SECRET like the
 * other crons. Only members who joined on or after the feature's epoch and
 * inside the 30-day window are considered, each stage is claimed before it is
 * sent, and the two follow-up stages send nothing when the member has nothing
 * outstanding. `?orgId=` runs one team for testing.
 *
 * The response is counts only — never a member's email address or a team's
 * content.
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
    const summary = await runMemberOnboarding({ orgId });
    return Response.json({ ok: true, summary: { ...summary, errors: summary.errors.length } });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Member onboarding run failed",
      },
      { status: 500 },
    );
  }
}
