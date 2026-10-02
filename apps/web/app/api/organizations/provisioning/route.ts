import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { startTeamProvisioning } from "../../../../lib/provisioning/start";
import type { ProvisioningStatus } from "../../../../lib/provisioning/model";
import { z } from "zod";
import { getRun } from "workflow/api";
import { initializeTeamDefaults } from "../../../../lib/provisioning/defaults";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Sign in to view setup." }, { status: 401 });
  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!z.string().uuid().safeParse(orgId).success) return Response.json({ error: "Choose your team." }, { status: 400 });
  const job = await withRls({ userId: session.user.id, orgId: orgId! }, async (client) =>
    (await client.query<ProvisioningStatus & { workflowRunId?: string; updatedAt: string }>(`SELECT state,phase,completed_phases AS "completedPhases",error,verified_at::text AS "verifiedAt",retry_after_at::text AS "retryAfterAt",updated_at::text AS "updatedAt",workflow_run_id AS "workflowRunId" FROM team_provisioning_jobs WHERE org_id=$1::uuid`, [orgId])).rows[0]);
  // A runtime failure before the first user step never reaches the workflow's
  // catch block. Reconcile the persisted run instead of leaving a spinner forever.
  if (job?.workflowRunId && (job.state === "queued" || (job.state === "running" && Date.now() - Date.parse(job.updatedAt) > 60_000))) {
    const status = await getRun(job.workflowRunId).status.catch(() => null);
    if (status === "failed" || status === "cancelled") {
      job.state = "failed";
      job.error = "Background setup stopped. Retry to resume your saved progress.";
      await withRls({ userId: session.user.id, orgId: orgId! }, client => client.query(`UPDATE team_provisioning_jobs
        SET state='failed',retry_after_at=NULL,error=$2,updated_at=now() WHERE org_id=$1::uuid
        AND state IN ('queued','running') AND workflow_run_id=$3
        AND has_org_role(org_id,ARRAY['owner','admin']::org_role[])`, [orgId, job.error, job.workflowRunId]));
    }
  }
  if (job) delete job.workflowRunId;
  return Response.json(job ?? { error: "Team setup not found." }, { status: job ? 200 : 404, headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Sign in to resume setup." }, { status: 401 });
  const parsed = z.object({ orgId: z.string().uuid() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose your team." }, { status: 400 });
  const orgId = parsed.data.orgId;
  const updated = await withRls({ userId: session.user.id, orgId }, async (client) => {
    const updated = await client.query(`UPDATE team_provisioning_jobs SET state='queued',error=NULL,retry_after_at=NULL,updated_at=now()
    WHERE org_id=$1::uuid AND (state='failed' OR (state IN ('queued','running') AND updated_at<now()-interval '10 minutes'))
    AND has_org_role(org_id,ARRAY['owner','admin']::org_role[]) RETURNING org_id`, [orgId]);
    if (updated.rowCount) {
      await initializeTeamDefaults(client, orgId, { inTransaction: true });
      await client.query("UPDATE team_provisioning_jobs SET completed_phases=array_append(completed_phases,'tools') WHERE org_id=$1 AND NOT('tools'=ANY(completed_phases))", [orgId]);
    }
    return updated;
  });
  if (!updated.rowCount) return Response.json({ error: "Setup is already running, complete, or unavailable to your role." }, { status: 409 });
  await startTeamProvisioning(orgId, session.user.id);
  return Response.json({ accepted: true, workspaceReady: true }, { status: 202 });
}
