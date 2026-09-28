import { assertCronAuthorized } from "../../../../lib/reference/run-ingest";
import { queueDueReadableHubSyncs } from "../../../../lib/google-sheets/hub-jobs";

export const runtime = "nodejs";
export const maxDuration = 120;
export async function GET(request: Request) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  if (!process.env.VANTAGE_SHEETS_HUB_SECRET) return Response.json({ error: "Operator Google sync is not configured." }, { status: 503 });
  try {
    const result = await queueDueReadableHubSyncs();
    return Response.json(result, { status: result.failed ? 503 : 202 });
  } catch { return Response.json({ error: "Google sync jobs could not be queued." }, { status: 503 }); }
}
