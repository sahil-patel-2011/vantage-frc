import { assertCronAuthorized } from "../../../../lib/reference/run-ingest";
import { queueDueReadableHubSyncs, queueReadableHubSync } from "../../../../lib/google-sheets/hub-jobs";

export const runtime = "nodejs";
export const maxDuration = 120;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** For an operator to run by hand. Not on a schedule: open tabs and the daily season sync do it. */
export async function GET(request: Request) {
  return due(request);
}

/** A signed-in ping posts `{ orgId }` after its membership check. The sweep still lives here. */
export async function POST(request: Request) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  let body: { orgId?: unknown } = {};
  try {
    body = (await request.json()) as { orgId?: unknown };
  } catch {
    body = {};
  }
  if (typeof body.orgId === "string" && body.orgId) {
    if (!UUID.test(body.orgId)) return Response.json({ error: "orgId must be a UUID" }, { status: 400 });
    try {
      const queued = await queueReadableHubSync(body.orgId);
      return Response.json({ queued }, { status: queued ? 202 : 200 });
    } catch {
      return Response.json({ error: "Google sync jobs could not be queued." }, { status: 503 });
    }
  }
  return due(request);
}

async function due(request: Request) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  try {
    const result = await queueDueReadableHubSyncs();
    return Response.json(result, { status: result.failed ? 503 : result.queued ? 202 : 200 });
  } catch { return Response.json({ error: "Google sync jobs could not be queued." }, { status: 503 }); }
}
