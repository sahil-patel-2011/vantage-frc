/**
 * Who may administer the team roster surfaces (Roles, Training Matrix).
 *
 * These screens decide who is certified to run the mill and who holds Safety Captain. Both routes
 * used to accept any org member — the only check was `SELECT 1 FROM memberships` — so a `viewer`
 * could certify themselves on a skill or hand themselves a lead role. `org_role` is
 * ('owner','admin','scout','viewer'), so owner/admin is the whole management tier; there is no
 * finer-grained capability table to defer to yet.
 *
 * Reads stay open to every member: knowing who is certified is exactly the information a team
 * needs to share. Only the writes are gated.
 */

import type { PoolClient } from "@neondatabase/serverless";

export const MANAGING_ROLES = ["owner", "admin"] as const;
export type ManagingRole = (typeof MANAGING_ROLES)[number];

export function isOrgManager(role: string | null | undefined): role is ManagingRole {
  return role === "owner" || role === "admin";
}

/** Throws with the sentence the member should read. `action` completes "Only an owner or admin can …". */
export function assertOrgManager(
  role: string | null | undefined,
  action: string,
): asserts role is ManagingRole {
  if (!isOrgManager(role)) throw new Error(`Only an owner or admin can ${action}`);
}

export async function orgRole(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<string | null> {
  const row = await client.query<{ role: string }>(
    `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
    [orgId, userId],
  );
  return row.rows[0]?.role ?? null;
}

/** Membership check plus the management gate, in the order the caller wants them reported. */
export async function requireOrgManager(
  client: PoolClient,
  orgId: string,
  userId: string,
  action: string,
): Promise<ManagingRole> {
  const role = await orgRole(client, orgId, userId);
  if (!role) throw new Error("forbidden");
  assertOrgManager(role, action);
  return role;
}
