import type { PoolClient } from "@neondatabase/serverless";

export type OrgCapability =
  | "manage_api_keys"
  | "manage_team_settings"
  | "manage_members"
  | "manage_billing";

/**
 * Gate org-admin API routes. Uses owner/admin membership until the
 * member-capabilities migration is applied in production.
 */
export async function assertOrgCapability(
  client: PoolClient,
  orgId: string,
  _capability: OrgCapability,
): Promise<void> {
  const role = await client.query(
    `SELECT 1
     FROM memberships
     WHERE org_id = $1::uuid
       AND user_id = current_app_user_id()
       AND role = ANY (ARRAY['owner','admin']::org_role[])`,
    [orgId],
  );
  if (!role.rowCount) {
    throw new Error("Organization administrator access required");
  }
}
