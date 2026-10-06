import type { PoolClient } from "@neondatabase/serverless";

/** One server/RLS contract for delegated scouting management. */
export async function canManageScouting(client: PoolClient, orgId: string): Promise<boolean> {
  const result = await client.query<{ allowed: boolean }>("SELECT has_org_capability($1::uuid, 'manage_scouting'::org_capability) AS allowed", [orgId]);
  return result.rows[0]?.allowed === true;
}

export async function assertScoutingLead(client: PoolClient, orgId: string): Promise<void> {
  if (!await canManageScouting(client, orgId)) throw Object.assign(new Error("Scouting lead access required"), { status: 403 });
}
