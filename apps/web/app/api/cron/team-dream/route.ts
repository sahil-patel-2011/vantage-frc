import { assertCronAuthorized } from "../../../../lib/reference/run-ingest";
import { runTeamDream } from "../../../../lib/dreaming/run-dream";

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Nightly team memory consolidation ("dreaming") — see docs/DREAMING.md.
 * Worker-only (vantage_worker); Hobby's two-cron ceiling means this is
 * usually triggered by an external ticker with the CRON_SECRET bearer.
 * `?orgId=` runs a single org for testing. On a UTC Saturday each org also
 * gets the week roll-up (kind='weekly'). The response is counts only — never
 * org content.
 *
 * Members trigger a run for their OWN org through POST /api/dreams instead,
 * which authenticates an owner/admin rather than accepting this secret.
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
    const summary = await runTeamDream({ orgId });
    return Response.json(summary);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Team dream run failed" },
      { status: 500 },
    );
  }
}
