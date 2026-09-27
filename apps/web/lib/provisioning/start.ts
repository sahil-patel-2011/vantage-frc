import { start } from "workflow/api";
import { teamProvisioningWorkflow } from "./workflow";
import { withRls } from "@vantage/db";
export async function startTeamProvisioning(orgId: string, userId: string): Promise<boolean> {
  try {
    const run = await start(teamProvisioningWorkflow, [orgId]);
    await withRls({ userId, orgId }, (client) => client.query("UPDATE team_provisioning_jobs SET workflow_run_id=$2,updated_at=now() WHERE org_id=$1::uuid", [orgId, run.runId]));
    return true;
  } catch {
    await withRls({ userId, orgId }, (client) => client.query("UPDATE team_provisioning_jobs SET state='failed',retry_after_at=NULL,error='Background setup could not start. Retry to resume.',updated_at=now() WHERE org_id=$1::uuid AND state<>'ready'", [orgId]));
    return false;
  }
}
