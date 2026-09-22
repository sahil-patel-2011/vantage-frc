import { runScheduledResearchSweep } from "@vantage/intel-research/production-worker";
import { assertCronAuthorized } from "../../../../lib/reference/run-ingest";
import { publicErrorMessage } from "../../../../lib/security/public-error";

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
        error: publicErrorMessage(error, "Research sweep failed"),
      },
      { status: 500 },
    );
  }
}
