import { assertCronAuthorized } from "../../../../lib/reference/run-ingest";
import { tickAssemblyManualQueue } from "../../../../lib/assembly-manual/worker";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * One worker tick for the assembly-manual queue.
 *
 * This is the worker trigger, not a product route: it takes the CRON_SECRET
 * bearer, runs on the admin connection, and is meant to be called on a timer by
 * whatever ticker the deployment uses (the team's relay, an external cron, or
 * a platform scheduler). It advances ONE run by one bounded slice and returns
 * counts — never CAD content.
 *
 * A run that is not finished at the end of a slice is handed back to the queue
 * with its checkpoint intact, so a robot that takes four hours takes as many
 * ticks as it needs and survives every one of them being killed.
 */
async function run(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const sliceSeconds = Number(url.searchParams.get("sliceSeconds") ?? "");
  const maxRuns = Number(url.searchParams.get("maxRuns") ?? "");

  try {
    const result = await tickAssemblyManualQueue({
      ...(Number.isFinite(sliceSeconds) && sliceSeconds > 0
        ? { sliceMs: Math.min(240, Math.max(30, Math.round(sliceSeconds))) * 1000 }
        : { sliceMs: 240_000 }),
      ...(Number.isFinite(maxRuns) && maxRuns > 0 ? { maxRuns: Math.min(3, Math.round(maxRuns)) } : {}),
    });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The assembly manual tick failed." },
      { status: 500 },
    );
  }
}

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
