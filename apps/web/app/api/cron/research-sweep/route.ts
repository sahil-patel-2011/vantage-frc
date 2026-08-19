import { runScheduledResearchSweep } from "@vantage/intel-research/production-worker";
import { assertCronAuthorized } from "../../../../lib/reference/run-ingest";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Worker-only research sweep. Hobby keeps this piggybacked on season TBA sync
 * (two-cron ceiling). Pro / external tickers can hit this path directly.
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
    const summary = await runScheduledResearchSweep();
    return Response.json({ ok: true, summary });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Research sweep failed",
      },
      { status: 500 },
    );
  }
}
