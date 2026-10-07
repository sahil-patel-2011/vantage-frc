import type { PoolClient } from "@neondatabase/serverless";

/** One server/RLS contract for delegated scouting management. */
export async function canManageScouting(client: PoolClient, orgId: string): Promise<boolean> {
  const result = await client.query<{ allowed: boolean }>("SELECT has_org_capability($1::uuid, 'manage_scouting'::org_capability) AS allowed", [orgId]);
  return result.rows[0]?.allowed === true;
}

export async function assertScoutingLead(client: PoolClient, orgId: string): Promise<void> {
  if (!await canManageScouting(client, orgId)) throw Object.assign(new Error("Scouting lead access required"), { status: 403 });
}

/** Current team coordinators; revocation also stops future scouting notices. */
export async function listScoutingCoordinators(client: PoolClient, orgId: string): Promise<Array<{ userId: string }>> {
  const result = await client.query<{ userId: string }>(
    `SELECT m.user_id::text AS "userId" FROM memberships m
     WHERE m.org_id=$1::uuid AND (m.role IN ('owner','admin') OR EXISTS (
       SELECT 1 FROM membership_capabilities c
       WHERE c.org_id=m.org_id AND c.user_id=m.user_id
         AND c.capability='manage_scouting'::org_capability
     )) ORDER BY m.user_id`,
    [orgId],
  );
  return result.rows;
}
