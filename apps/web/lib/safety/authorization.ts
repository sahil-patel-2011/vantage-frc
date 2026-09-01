/**
 * Who may erase a safety incident.
 *
 * Migration 0502 replaced 0050's DELETE policy so only owner/admin can delete
 * (`has_org_role(org_id, ARRAY['owner','admin']::org_role[])`). A near-miss log
 * is team history, not a draft the author can take back. `org_role` is
 * owner/admin/scout/viewer — there is no mentor value on memberships, so owner
 * and admin are the whole management tier.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { isOrgManager, orgRole } from "../team-admin/permissions";

export class SafetyAuthError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 = 403,
  ) {
    super(message);
    this.name = "SafetyAuthError";
  }
}

export function canDeleteSafetyIncident(role: string | null | undefined): boolean {
  return isOrgManager(role);
}

/** Throws 403. The sentence names the rule so a student knows why the delete was refused. */
export function assertCanDeleteSafetyIncident(role: string | null | undefined): void {
  if (canDeleteSafetyIncident(role)) return;
  throw new SafetyAuthError("Only an owner or admin can delete a safety incident.");
}

/**
 * Look up the caller's org role, refuse anyone who is not an owner/admin, then delete
 * the incident scoped to that org. The DELETE never runs for a student — including the
 * member who reported the row. RLS 0502 matches that gate, so a reporter cannot
 * erase their own row even if they bypass the app layer.
 */
export async function deleteSafetyIncident(
  client: PoolClient,
  input: { orgId: string; incidentId: string; userId: string },
): Promise<void> {
  const role = await orgRole(client, input.orgId, input.userId);
  if (!role) throw new SafetyAuthError("Organization membership required");
  assertCanDeleteSafetyIncident(role);

  const deleted = await client.query(
    `DELETE FROM safety_incidents WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.incidentId, input.orgId],
  );
  if (!deleted.rowCount) throw new SafetyAuthError("Incident not found", 404);
}
