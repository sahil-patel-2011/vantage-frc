import { assertCronAuthorized } from "../../../../lib/reference/run-ingest";
import { dispatchRecoveryJournal } from "../../../../lib/recovery/dispatch";

export const runtime = "nodejs";
/** For an operator to run by hand. Not on a schedule: see lib/recovery/dispatch.ts. */
export async function GET(request: Request) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  try {
    const result = await dispatchRecoveryJournal();
    return Response.json(result, { status: result.accepted ? 202 : 200 });
  } catch { return Response.json({ error: "Recovery work could not start." }, { status: 503 }); }
}
