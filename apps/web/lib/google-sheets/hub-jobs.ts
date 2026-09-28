import { randomUUID } from "node:crypto";
import { start } from "workflow/api";
import { provisioningPool } from "../provisioning/pool";
import { readableHubWorkflow } from "./hub-workflow";

/** Called only after a membership check, or by the authenticated operator cron. */
export async function queueReadableHubSync(orgId: string): Promise<boolean> {
  const client = await provisioningPool().connect();
  const generation = randomUUID();
  try {
    const claimed = await client.query(`INSERT INTO team_readable_sync_jobs(org_id,generation,state)
      SELECT id,$2::uuid,'queued' FROM organizations o WHERE id=$1::uuid
        AND NOT EXISTS(SELECT 1 FROM team_provisioning_jobs p WHERE p.org_id=o.id AND (p.state<>'ready' OR p.verified_at IS NULL))
      ON CONFLICT(org_id) DO UPDATE SET generation=EXCLUDED.generation,state='queued',workflow_run_id=NULL,
        requested_at=now(),updated_at=now(),retry_after_at=NULL,error=NULL,completed_workbooks='{}'::jsonb
      WHERE (team_readable_sync_jobs.state IN ('ready','failed') AND team_readable_sync_jobs.requested_at<now()-interval '2 minutes')
        OR (team_readable_sync_jobs.updated_at<now()-interval '30 minutes'
          AND COALESCE(team_readable_sync_jobs.retry_after_at,now())<=now())
      RETURNING org_id`, [orgId, generation]);
    if (!claimed.rowCount) return false;
    try {
      const run = await start(readableHubWorkflow, [orgId, generation]);
      await client.query("UPDATE team_readable_sync_jobs SET workflow_run_id=$3,updated_at=now() WHERE org_id=$1::uuid AND generation=$2::uuid", [orgId, generation, run.runId]);
      return true;
    } catch {
      await client.query("UPDATE team_readable_sync_jobs SET state='failed',error='Google sync could not start. It will retry.',updated_at=now() WHERE org_id=$1::uuid AND generation=$2::uuid", [orgId, generation]);
      throw new Error("Google sync could not start.");
    }
  } finally { client.release(); }
}

/** The cron also refreshes teams with no browser open. No unready team is selected. */
export async function queueDueReadableHubSyncs(): Promise<{ examined: number; queued: number; failed: number }> {
  const client = await provisioningPool().connect();
  let orgIds: string[];
  try {
    orgIds = (await client.query<{ id: string }>(`SELECT o.id::text FROM organizations o
      LEFT JOIN team_readable_sync_jobs s ON s.org_id=o.id
      WHERE NOT EXISTS(SELECT 1 FROM team_provisioning_jobs p WHERE p.org_id=o.id AND (p.state<>'ready' OR p.verified_at IS NULL))
        AND (s.org_id IS NULL OR (s.state IN ('ready','failed') AND s.requested_at<now()-interval '2 minutes')
          OR (s.updated_at<now()-interval '30 minutes' AND COALESCE(s.retry_after_at,now())<=now()))
      ORDER BY s.last_verified_at NULLS FIRST,o.id LIMIT 100`)).rows.map(row => row.id);
  } finally { client.release(); }
  let queued = 0;
  let failed = 0;
  // Bound dispatch pressure on the database and Workflow provider.
  for (let index = 0; index < orgIds.length; index += 4) {
    const results = await Promise.allSettled(orgIds.slice(index, index + 4).map(queueReadableHubSync));
    for (const result of results) {
      if (result.status === "rejected") failed++;
      else if (result.value) queued++;
    }
  }
  return { examined: orgIds.length, queued, failed };
}
