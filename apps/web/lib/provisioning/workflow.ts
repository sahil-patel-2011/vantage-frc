import { provisioningPool } from "./pool";
import { PROVISIONING_PHASES, WORKSPACE_WORKBOOK_NAMES, type ProvisioningPhase, type WorkspaceWorkbookName } from "./model";
import { RetryableError } from "workflow";
import { loadSheetsHubBridge, readHubTeam } from "../google-sheets/sheets-hub";
import { APPS_SCRIPT_WORKSPACE_VERSION } from "../google-sheets/apps-script-source";
import { provisionWorkbooks, verifyWorkbookLayout, verifyWorkbookTables, workspaceWorkbooks } from "./workbooks";
import { loadWorkbookSource } from "../microsoft/workbook-sync";
import { readRecoveryRecord } from "../recovery/sheets";
import { initializeTeamDefaults } from "./defaults";
import { ensureRecoveryBoundary } from "./recovery-boundary";
import { recordProviderWait } from "./provider-wait";

async function provisionPhase(orgId: string, phase: ProvisioningPhase, workbook?: WorkspaceWorkbookName) {
  "use step";
  const client = await provisioningPool().connect();
  let locked = false;
  try {
    locked = (await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked", [`provision:${orgId}`])).rows[0]?.locked ?? false;
    if (!locked) throw new RetryableError("Another setup step is running.", { retryAfter: "10s" });
    const job = (await client.query<{ completed: string[] }>("SELECT completed_phases AS completed FROM team_provisioning_jobs WHERE org_id=$1::uuid", [orgId])).rows[0];
    if (!job) throw new Error("Team setup job not found.");
    if (job.completed.includes(phase)) return;
    const recoveryBoundary = phase === "recovery" ? await ensureRecoveryBoundary(client, orgId) : null;
    await client.query("UPDATE team_provisioning_jobs SET state='running',phase=$2,error=NULL,retry_after_at=NULL,attempts=attempts+1,updated_at=now() WHERE org_id=$1::uuid", [orgId, phase]);
    const team = await readHubTeam(client, orgId);
    if (!team) throw new Error("Team workspace not found.");
    if (phase === "workspace") {
      const bridge = await loadSheetsHubBridge(client);
      if (!bridge) throw new Error("Google workspace setup is unavailable. Contact Vantage support.");
      const status = await bridge.ping({ hub: true });
      if (status.version < APPS_SCRIPT_WORKSPACE_VERSION) throw new Error("The operator Google bridge needs an update.");
      const folder = await bridge.call<{ ok: boolean; folderId: string }>("workspace.ensure", { team });
      await client.query("UPDATE team_provisioning_jobs SET resources=resources||$2::jsonb WHERE org_id=$1::uuid", [orgId, JSON.stringify({ folderId: folder.folderId })]);
    }
    if (phase === "sheets" && workbook) {
      const bridge = await loadSheetsHubBridge(client);
      if (!bridge) throw new Error("Google workspace setup is unavailable.");
      await provisionWorkbooks(bridge, team, await loadWorkbookSource(client, orgId, { strict: true }), {
        only: workbook,
        onVerified: async (name, resource) => {
          await client.query("UPDATE team_provisioning_jobs SET resources=jsonb_set(resources,'{workbooks}',COALESCE(resources->'workbooks','{}'::jsonb)||$2::jsonb),updated_at=now() WHERE org_id=$1::uuid", [orgId, JSON.stringify({ [name]: resource })]);
        },
      });
      return;
    }
    if (phase === "tools") {
      await initializeTeamDefaults(client, orgId);
    }
    if (phase === "recovery") {
      const bridge = await loadSheetsHubBridge(client);
      if (!bridge) throw new Error("Google recovery verification is unavailable.");
      const snapshot = (await client.query<{ id: string; resources: { bookKey?: string; id?: string } }>(`SELECT id::text,resources FROM recovery_checkpoints
        WHERE kind='snapshot' AND state='verified' AND verified_at>now()-interval '28 days'
        ORDER BY verified_at DESC LIMIT 1`)).rows[0];
      if (!snapshot?.resources.bookKey || !snapshot.resources.id) throw new Error("A verified Google recovery snapshot is required before team setup can finish.");
      const copy = JSON.parse(await readRecoveryRecord(bridge, snapshot.resources.bookKey, snapshot.resources.id)) as { version?: number; kind?: string; id?: string };
      if (copy.version !== 1 || copy.kind !== "snapshot" || copy.id !== snapshot.id) throw new Error("Google returned an invalid recovery snapshot.");
      const pending = await client.query(`SELECT 1 FROM recovery_events WHERE exported_at IS NULL AND occurred_at<=$1::timestamptz LIMIT 1`, [recoveryBoundary]);
      if (pending.rowCount) throw new RetryableError("Initial team records are waiting for recovery verification.", { retryAfter: "20s" });
      await client.query("UPDATE team_provisioning_jobs SET resources=resources||$2::jsonb WHERE org_id=$1::uuid", [orgId, JSON.stringify({ recoveryCheckpointId: snapshot.id })]);
    }
    if (phase === "verify") {
      const bridge = await loadSheetsHubBridge(client);
      if (!bridge) throw new Error("Google workspace verification is unavailable.");
      for (const group of workspaceWorkbooks(team, await loadWorkbookSource(client, orgId, { strict: true }), new Date())) {
      const read = await bridge.call<{ ok: boolean; values?: Record<string, unknown[][]> }>("read", { team: group.team, sheets: group.tables.map((table) => table.spec.sheet) });
      verifyWorkbookTables(group.tables, read.values, true);
      const layout = await bridge.call<{ ok: boolean; layout: Parameters<typeof verifyWorkbookLayout>[1] }>("team.layout", { team: group.team, sheets: group.tables.map((table) => table.spec.sheet) });
      verifyWorkbookLayout(group.tables, layout.layout);
      }
    }
    await client.query("UPDATE team_provisioning_jobs SET completed_phases=array_append(completed_phases,$2),updated_at=now() WHERE org_id=$1::uuid AND NOT($2=ANY(completed_phases))", [orgId, phase]);
    if (phase === "verify") await client.query("UPDATE team_provisioning_jobs SET state='ready',phase='ready',verified_at=now(),updated_at=now() WHERE org_id=$1::uuid", [orgId]);
  } catch (error) {
    const retryMs = locked ? await recordProviderWait(client, orgId, error) : null;
    if (retryMs !== null) throw new RetryableError("Google setup is waiting for its provider allowance.", { retryAfter: retryMs });
    throw error;
  } finally {
    try {
      if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`provision:${orgId}`]);
    } finally { client.release(); }
  }
}
provisionPhase.maxRetries = 5;

async function recordProvisioningFailure(orgId: string) {
  "use step";
  const client = await provisioningPool().connect();
  try {
    const phase = (await client.query<{ phase: ProvisioningPhase }>("SELECT phase FROM team_provisioning_jobs WHERE org_id=$1::uuid", [orgId])).rows[0]?.phase;
    const label = PROVISIONING_PHASES.find((item) => item.id === phase)?.label.toLowerCase() ?? "setup";
    await client.query("UPDATE team_provisioning_jobs SET state='failed',retry_after_at=NULL,error=$2,updated_at=now() WHERE org_id=$1::uuid AND state<>'ready'", [orgId, `Could not finish ${label}. Retry to resume, or contact Vantage support.`]);
  } finally { client.release(); }
}

export async function teamProvisioningWorkflow(orgId: string) {
  "use workflow";
  try {
    for (const phase of PROVISIONING_PHASES) {
      if (phase.id === "sheets") for (const workbook of WORKSPACE_WORKBOOK_NAMES) await provisionPhase(orgId, "sheets", workbook);
      await provisionPhase(orgId, phase.id);
    }
  } catch (error) {
    await recordProvisioningFailure(orgId);
    throw error;
  }
}
