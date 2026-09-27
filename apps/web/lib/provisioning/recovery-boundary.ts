import type { PoolClient } from "@neondatabase/serverless";

/** Persist once after defaults/workbooks finish; status writes cannot move this boundary. */
export async function ensureRecoveryBoundary(client: PoolClient, orgId: string): Promise<Date> {
  const result = await client.query<{ boundary: Date }>(`UPDATE team_provisioning_jobs
    SET recovery_boundary_at=COALESCE(recovery_boundary_at,clock_timestamp())
    WHERE org_id=$1::uuid RETURNING recovery_boundary_at AS boundary`, [orgId]);
  if (!result.rows[0]) throw new Error("Team setup job not found.");
  return result.rows[0].boundary;
}
