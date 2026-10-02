import { start } from "workflow/api";
import { recoveryJournalWorkflow } from "../../../../lib/recovery/workflow";
import { assertCronAuthorized } from "../../../../lib/reference/run-ingest";
import { recoveryJournalReadiness } from "../../../../lib/recovery/readiness";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  try {
    const readiness = await recoveryJournalReadiness();
    if (readiness !== "ready") return Response.json({ accepted: false, reason: readiness });
    const run = await start(recoveryJournalWorkflow, []);
    return Response.json({ accepted: true, runId: run.runId }, { status: 202 });
  } catch { return Response.json({ error: "Recovery work could not start." }, { status: 503 }); }
}
