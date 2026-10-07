import { start } from "workflow/api";
import { teamProvisioningWorkflow } from "./workflow";
import { withRls } from "@vantage/db";
import { hostedBackgroundWorkEnabled } from "../hosted-background-work";
export async function startTeamProvisioning(orgId: string, userId: string): Promise<boolean> {
  if (!hostedBackgroundWorkEnabled()) return false;
  try {
    const run = await start(teamProvisioningWorkflow, [orgId]);
    await withRls({ userId, orgId }, (client) => client.query("UPDATE team_provisioning_jobs SET workflow_run_id=$2,updated_at=now() WHERE org_id=$1::uuid", [orgId, run.runId]));
    return true;
  } catch {
    // Core team creation already committed. Optional dispatch bookkeeping must
    // not turn that durable success into a claim error and invite a duplicate retry.
    await withRls({ userId, orgId }, (client) => client.query("UPDATE team_provisioning_jobs SET state='failed',retry_after_at=NULL,error='Background setup could not start. Retry to resume.',updated_at=now() WHERE org_id=$1::uuid AND state<>'ready'", [orgId])).catch(() => undefined);
    return false;
  }
}
