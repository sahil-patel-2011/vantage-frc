import type { PoolClient } from "@neondatabase/serverless";
import { assertSponsorsAllowed, auth } from "@vantage/core";
import { headers } from "next/headers";

/**
 * Shared tenancy guards for sponsor / grant / visit / outreach finance APIs.
 * Always pair with withRls({ userId, orgId }) — RLS is the backstop; these
 * helpers make wrong-orgId return an explicit 403 instead of empty 200s.
 */

export class TenantHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TenantHttpError";
  }
}

export async function requireTenantSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new TenantHttpError(401, "Authentication required");
  return session;
}

export async function requireOrgMember(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<{ role: string; admin: boolean }> {
  const result = await client.query<{ role: string }>(
    `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
    [orgId, userId],
  );
  if (!result.rows[0]) throw new TenantHttpError(403, "Organization access denied");
  const role = result.rows[0].role;
  return { role, admin: role === "owner" || role === "admin" };
}

/** Org member + funding profile allows sponsor Soft-UI / APIs. */
export async function requireSponsorsMember(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<{ role: string; admin: boolean }> {
  const member = await requireOrgMember(client, orgId, userId);
  try {
    await assertSponsorsAllowed(client, orgId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sponsor tools are disabled for this organization";
    throw new TenantHttpError(403, message);
  }
  return member;
}

export async function requireOrgAdmin(client: PoolClient, orgId: string, userId: string) {
  const member = await requireOrgMember(client, orgId, userId);
  if (!member.admin) {
    throw new TenantHttpError(403, "Organization administrator access required");
  }
  return member;
}

export async function requireSponsorsAdmin(client: PoolClient, orgId: string, userId: string) {
  const member = await requireSponsorsMember(client, orgId, userId);
  if (!member.admin) {
    throw new TenantHttpError(403, "Organization administrator access required");
  }
  return member;
}

/** Ensures a sponsor row belongs to the caller's org (blocks cross-org IDOR). */
export async function requireSponsorInOrg(client: PoolClient, orgId: string, sponsorId: string) {
  const result = await client.query(
    `SELECT 1 FROM sponsors WHERE id = $1::uuid AND org_id = $2::uuid`,
    [sponsorId, orgId],
  );
  if (!result.rowCount) throw new TenantHttpError(404, "Sponsor not found");
}

export async function requireGrantApplicationInOrg(
  client: PoolClient,
  orgId: string,
  applicationId: string,
) {
  const result = await client.query(
    `SELECT 1 FROM grant_applications WHERE id = $1::uuid AND org_id = $2::uuid`,
    [applicationId, orgId],
  );
  if (!result.rowCount) throw new TenantHttpError(404, "Grant application not found");
}

export async function requireGrantOpportunityInOrg(
  client: PoolClient,
  orgId: string,
  opportunityId: string,
) {
  const result = await client.query(
    `SELECT 1 FROM grant_opportunities WHERE id = $1::uuid AND org_id = $2::uuid`,
    [opportunityId, orgId],
  );
  if (!result.rowCount) throw new TenantHttpError(404, "Grant opportunity not found");
}

export function tenantErrorResponse(error: unknown, fallback = "Request failed") {
  if (error instanceof TenantHttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : fallback;
  const status =
    /access denied|administrator access|membership required|Sponsor tools are disabled/i.test(message)
      ? 403
      : 400;
  return Response.json({ error: message }, { status });
}

/** Pure predicate used by unit tests — mirrors requireOrgMember denial. */
export function isWrongOrgDenied(membershipRowCount: number): boolean {
  return membershipRowCount === 0;
}
