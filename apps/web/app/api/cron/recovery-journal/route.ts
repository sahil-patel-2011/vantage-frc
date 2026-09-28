import { start } from "workflow/api";
import { recoveryJournalWorkflow } from "../../../../lib/recovery/workflow";
import { assertCronAuthorized } from "../../../../lib/reference/run-ingest";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  try {
    const run = await start(recoveryJournalWorkflow, []);
    return Response.json({ accepted: true, runId: run.runId }, { status: 202 });
  } catch { return Response.json({ error: "Recovery work could not start." }, { status: 503 }); }
}
