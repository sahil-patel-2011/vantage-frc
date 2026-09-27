import { FatalError, RetryableError } from "workflow";
import { provisioningPool } from "../provisioning/pool";
import { WORKSPACE_WORKBOOK_NAMES, type WorkspaceWorkbookName } from "../provisioning/model";
import { loadSheetsHubBridge, readHubTeam } from "./sheets-hub";
import { loadWorkbookSource } from "../microsoft/workbook-sync";
import { provisionWorkbooks } from "../provisioning/workbooks";
import { describeGoogleError, isGoogleSheetsError } from "./google-api";

async function refreshWorkspace(orgId: string, generation: string, name: WorkspaceWorkbookName) {
  "use step";
  const client = await provisioningPool().connect();
  let locked = false;
  try {
    locked = (await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended('sheets-hub:' || $1::text,0)) AS locked", [orgId])).rows[0]?.locked ?? false;
    if (!locked) throw new RetryableError("This team's Google sync is already running.", { retryAfter: "10s" });
    const job = (await client.query<{ completed: Record<string, unknown> }>("SELECT completed_workbooks AS completed FROM team_readable_sync_jobs WHERE org_id=$1::uuid AND generation=$2::uuid", [orgId, generation])).rows[0];
    if (!job || job.completed[name]) return;
    const pending = await client.query("SELECT 1 FROM team_provisioning_jobs WHERE org_id=$1::uuid AND (state<>'ready' OR verified_at IS NULL)", [orgId]);
    if (pending.rowCount) throw new FatalError("Team setup must finish before automatic sync.");
    await client.query("UPDATE team_readable_sync_jobs SET state='running',retry_after_at=NULL,error=NULL,updated_at=now() WHERE org_id=$1::uuid AND generation=$2::uuid", [orgId, generation]);
    const bridge = await loadSheetsHubBridge(client);
    if (!bridge) throw new FatalError("The operator's Google connection is not configured.");
    const team = await readHubTeam(client, orgId);
    if (!team) throw new FatalError("The team no longer exists.");
    const sourceReadAt = new Date().toISOString();
    const source = await loadWorkbookSource(client, orgId, { strict: true });
    const resources = (await client.query<{ workbooks: Record<string, { id: string; hash: string }> }>(
      "SELECT resources->'workbooks' AS workbooks FROM team_provisioning_jobs WHERE org_id=$1::uuid", [orgId],
    )).rows[0]?.workbooks;
    const verified = await provisionWorkbooks(bridge, team, source, { only: name, verifyUnchanged: false, verifiedResources: resources });
    await client.query(`UPDATE team_provisioning_jobs SET resources=jsonb_set(resources,'{workbooks}',
      COALESCE(resources->'workbooks','{}'::jsonb)||$2::jsonb) WHERE org_id=$1::uuid AND state='ready'`, [orgId, JSON.stringify(verified)]);
    await client.query(`UPDATE team_readable_sync_jobs SET completed_workbooks=completed_workbooks||jsonb_build_object($3::text,
      jsonb_build_object('verifiedAt',clock_timestamp(),'sourceReadAt',$4::text)),
      updated_at=now() WHERE org_id=$1::uuid AND generation=$2::uuid`, [orgId, generation, name, sourceReadAt]);
  } catch (error) {
    if (locked) {
      const transient = isGoogleSheetsError(error) && ["unavailable", "throttled"].includes(error.kind);
      const retryMs = transient ? Math.max(1000, error.retryAfterMs ?? 30_000) : null;
      await client.query(`UPDATE team_readable_sync_jobs SET state=$3,error=$4,retry_after_at=$5::timestamptz,
        updated_at=now() WHERE org_id=$1::uuid AND generation=$2::uuid`,
      [orgId, generation, transient ? "waiting" : "failed", error instanceof FatalError ? error.message : describeGoogleError(error), retryMs ? new Date(Date.now() + retryMs).toISOString() : null]);
      if (retryMs) throw new RetryableError("Google sync is waiting for its provider. Saved progress will resume.", { retryAfter: retryMs });
    }
    throw error;
  } finally {
    try { if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended('sheets-hub:' || $1::text,0))", [orgId]); }
    finally { client.release(); }
  }
}
refreshWorkspace.maxRetries = 5;

async function finishReadableSync(orgId: string, generation: string, failed = false) {
  "use step";
  const client = await provisioningPool().connect();
  try {
    if (failed) {
      await client.query("UPDATE team_readable_sync_jobs SET state='failed',retry_after_at=NULL,error=COALESCE(error,'Google sync stopped. It will retry.'),updated_at=now() WHERE org_id=$1::uuid AND generation=$2::uuid", [orgId, generation]);
    } else {
      await client.query(`UPDATE team_readable_sync_jobs SET state='ready',last_verified_at=(SELECT min((value->>'sourceReadAt')::timestamptz) FROM jsonb_each(completed_workbooks)),updated_at=now(),error=NULL,retry_after_at=NULL
        WHERE org_id=$1::uuid AND generation=$2::uuid AND completed_workbooks ?& $3::text[]`, [orgId, generation, [...WORKSPACE_WORKBOOK_NAMES]]);
    }
  } finally { client.release(); }
}

export async function readableHubWorkflow(orgId: string, generation: string) {
  "use workflow";
  try {
    for (const name of WORKSPACE_WORKBOOK_NAMES) await refreshWorkspace(orgId, generation, name);
    await finishReadableSync(orgId, generation);
  } catch (error) {
    await finishReadableSync(orgId, generation, true);
    throw error;
  }
}
