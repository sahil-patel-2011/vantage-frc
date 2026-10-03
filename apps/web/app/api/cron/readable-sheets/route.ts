import { assertCronAuthorized } from "../../../../lib/reference/run-ingest";
import { queueDueReadableHubSyncs } from "../../../../lib/google-sheets/hub-jobs";

export const runtime = "nodejs";
export const maxDuration = 120;
/** For an operator to run by hand. Not on a schedule: open tabs and the daily season sync do it. */
export async function GET(request: Request) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  try {
    const result = await queueDueReadableHubSyncs();
    return Response.json(result, { status: result.failed ? 503 : result.queued ? 202 : 200 });
  } catch { return Response.json({ error: "Google sync jobs could not be queued." }, { status: 503 }); }
}
