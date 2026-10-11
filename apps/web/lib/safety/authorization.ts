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
 * Who may record or remove a tool certification or a shop-training completion (0723).
 *
 * The list is what a mentor reads before letting a freshman use the band saw, so a row in it is
 * an owner's or admin's attestation, the same rule as a guided-track lead sign-off (0719). A
 * student asks a lead to check them on the tool; the lead records it.
 */
export const CERTIFICATION_LEADS_ONLY =
  "Only an owner or admin can record or remove a certification. Ask one to check you on the tool and record it.";

export function canRecordCertification(role: string | null | undefined): boolean {
  return isOrgManager(role);
}

/** Throws 403 with the sentence above unless the caller leads the team. */
export async function assertCanRecordCertification(
  client: PoolClient,
  input: { orgId: string; userId: string },
): Promise<void> {
  const role = await orgRole(client, input.orgId, input.userId);
  if (!role) throw new SafetyAuthError("Organization membership required");
  if (!canRecordCertification(role)) throw new SafetyAuthError(CERTIFICATION_LEADS_ONLY);
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
