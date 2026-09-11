/**
 * The request-side half of 0620/0621 — the two capabilities this feature adds
 * to the delegation layer 0049 already shipped.
 *
 * `org_role` was NOT extended. `membership_capabilities` (0049) exists to
 * "grant elevated powers to scout/viewer without promoting them to full admin",
 * and `has_org_capability(org, capability)` already returns true for owner and
 * admin, so one call answers "owner, admin, or explicitly trusted with this".
 * `manage_budget` and `edit_docs` are two more values in that enum.
 *
 * None of this is the authorization. `has_org_capability` backs the RLS
 * policies on `season_budgets` and `knowledge_pages`, so a caller who never
 * touches this module still gets nothing from the database. These helpers exist
 * so a page can explain WHY a surface is closed instead of rendering a control
 * that 403s.
 *
 * Every query runs on the PoolClient from withRls, under the caller's own
 * `app.user_id`. org_id always comes from `resolveMembership`, never a body.
 */

import type { PoolClient } from "@neondatabase/serverless";

/** The two this feature owns. The other four (0049) are managed by /team/admin. */
export const FEATURE_CAPABILITIES = ["manage_budget", "edit_docs"] as const;
export type FeatureCapability = (typeof FEATURE_CAPABILITIES)[number];

export function isFeatureCapability(value: unknown): value is FeatureCapability {
  return typeof value === "string" && (FEATURE_CAPABILITIES as readonly string[]).includes(value);
}

export const CAPABILITY_LABELS: Record<FeatureCapability, string> = {
  manage_budget: "Budget access",
  edit_docs: "Doc editing",
};

/** Who may hand each one out. Mirrors the two RLS write policies exactly. */
export const CAPABILITY_GRANTED_BY: Record<FeatureCapability, string> = {
  manage_budget: "Owners and admins",
  edit_docs: "The team owner only",
};

export type OrgRole = "owner" | "admin" | "scout" | "viewer";

export type OrgMembership = {
  orgId: string;
  orgName: string;
  teamNumber: number | null;
  role: OrgRole;
};

export class CapabilityError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "CapabilityError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The org for this request. A requested org id is only ever a FILTER over the
 * caller's own memberships — it can never introduce one. Another team's id
 * matches no row and is refused here; RLS refuses it again underneath.
 */
export async function resolveMembership(
  client: PoolClient,
  userId: string,
  requestedOrgId: string | null,
): Promise<OrgMembership> {
  // A malformed id is not a membership. Treating it as "no filter" would hand
  // back a different team than the one that was asked for.
  if (requestedOrgId && !UUID.test(requestedOrgId)) {
    throw new CapabilityError(403, "You are not a member of that team.", "org_not_found");
  }

  const result = await client.query<OrgMembership>(
    `SELECT m.org_id::text AS "orgId",
            o.name AS "orgName",
            o.team_number AS "teamNumber",
            m.role::text AS role
       FROM memberships m
       JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = $1::uuid
        AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
      LIMIT 1`,
    [userId, requestedOrgId],
  );

  const membership = result.rows[0];
  if (!membership) {
    throw new CapabilityError(
      403,
      requestedOrgId
        ? "You are not a member of that team."
        : "Choose your team first.",
      "org_not_found",
    );
  }
  return membership;
}

/** owner/admin, or an explicit grant. One SQL function answers both. */
export async function hasCapability(
  client: PoolClient,
  orgId: string,
  capability: FeatureCapability,
): Promise<boolean> {
  const result = await client.query<{ allowed: boolean }>(
    `SELECT has_org_capability($1::uuid, $2::org_capability) AS allowed`,
    [orgId, capability],
  );
  return result.rows[0]?.allowed === true;
}

export function canManageBudget(client: PoolClient, orgId: string): Promise<boolean> {
  return hasCapability(client, orgId, "manage_budget");
}

export function canEditDocs(client: PoolClient, orgId: string): Promise<boolean> {
  return hasCapability(client, orgId, "edit_docs");
}

export type CapabilityGrant = {
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  capability: FeatureCapability;
  grantedByName: string | null;
  grantedAt: string;
};

/**
 * The EXPLICIT grants only. Owners and admins hold the capability without a
 * row, so callers must present them separately — a page that showed this list
 * alone would read as "nobody can do this", which is false.
 */
export async function listCapabilityGrants(
  client: PoolClient,
  orgId: string,
  capability: FeatureCapability,
): Promise<CapabilityGrant[]> {
  const result = await client.query<CapabilityGrant>(
    `SELECT c.user_id::text AS "userId",
            u.name,
            u.email,
            m.role::text AS role,
            c.capability::text AS capability,
            b.name AS "grantedByName",
            c.granted_at::text AS "grantedAt"
       FROM membership_capabilities c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN memberships m ON m.org_id = c.org_id AND m.user_id = c.user_id
       LEFT JOIN users b ON b.id = c.granted_by
      WHERE c.org_id = $1::uuid AND c.capability = $2::org_capability
      ORDER BY u.name, u.email`,
    [orgId, capability],
  );
  return result.rows;
}

/**
 * Insert a grant. The no-self-grant rule and the who-may-grant rule live in RLS
 * and in a table CHECK; the guards here exist only so a person gets a sentence
 * instead of a Postgres policy violation.
 */
export async function grantCapability(
  client: PoolClient,
  input: {
    orgId: string;
    actorUserId: string;
    targetUserId: string;
    capability: FeatureCapability;
  },
): Promise<void> {
  if (!UUID.test(input.targetUserId)) {
    throw new CapabilityError(400, "That is not a person on this team.", "not_a_member");
  }
  if (input.targetUserId === input.actorUserId) {
    throw new CapabilityError(
      400,
      "You cannot grant a role to yourself. Owners and admins already hold it anyway.",
      "self_grant",
    );
  }

  const target = await client.query(
    `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
    [input.orgId, input.targetUserId],
  );
  if (!target.rowCount) {
    throw new CapabilityError(400, "That person is not on this team.", "not_a_member");
  }

  const inserted = await client.query(
    `INSERT INTO membership_capabilities (org_id, user_id, capability, granted_by)
     VALUES ($1::uuid, $2::uuid, $3::org_capability, $4::uuid)
     ON CONFLICT (org_id, user_id, capability) DO NOTHING`,
    [input.orgId, input.targetUserId, input.capability, input.actorUserId],
  );

  // DO NOTHING hides an RLS refusal behind the same zero-row result as an
  // already-granted row, so say which one actually happened.
  if (!inserted.rowCount) {
    const existing = await client.query(
      `SELECT 1 FROM membership_capabilities
        WHERE org_id = $1::uuid AND user_id = $2::uuid AND capability = $3::org_capability`,
      [input.orgId, input.targetUserId, input.capability],
    );
    if (!existing.rowCount) {
      throw new CapabilityError(403, "You are not allowed to grant that role.", "not_allowed");
    }
  }
}

export async function revokeCapability(
  client: PoolClient,
  input: { orgId: string; targetUserId: string; capability: FeatureCapability },
): Promise<void> {
  if (!UUID.test(input.targetUserId)) {
    throw new CapabilityError(400, "That is not a person on this team.", "not_a_member");
  }
  const removed = await client.query(
    `DELETE FROM membership_capabilities
      WHERE org_id = $1::uuid AND user_id = $2::uuid AND capability = $3::org_capability`,
    [input.orgId, input.targetUserId, input.capability],
  );
  if (!removed.rowCount) {
    throw new CapabilityError(
      403,
      "That role was not removed — either it was already gone, or you are not allowed to remove it.",
      "not_allowed",
    );
  }
}

/**
 * Members a grant could be handed to: on the team, without the capability
 * already, and not an owner/admin (who hold it implicitly, so granting them a
 * row would be a control that changes nothing).
 */
export async function grantableMembers(
  client: PoolClient,
  orgId: string,
  capability: FeatureCapability,
): Promise<Array<{ userId: string; name: string; email: string; role: OrgRole }>> {
  const result = await client.query<{ userId: string; name: string; email: string; role: OrgRole }>(
    `SELECT m.user_id::text AS "userId", u.name, u.email, m.role::text AS role
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.org_id = $1::uuid
        AND m.role NOT IN ('owner', 'admin')
        AND NOT EXISTS (
          SELECT 1 FROM membership_capabilities c
           WHERE c.org_id = m.org_id AND c.user_id = m.user_id
             AND c.capability = $2::org_capability
        )
      ORDER BY u.name, u.email
      LIMIT 300`,
    [orgId, capability],
  );
  return result.rows;
}

/** Owners and admins — the people who hold every capability without a grant. */
export async function implicitHolders(
  client: PoolClient,
  orgId: string,
): Promise<Array<{ userId: string; name: string; email: string; role: OrgRole }>> {
  const result = await client.query<{ userId: string; name: string; email: string; role: OrgRole }>(
    `SELECT m.user_id::text AS "userId", u.name, u.email, m.role::text AS role
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.org_id = $1::uuid AND m.role IN ('owner', 'admin')
      ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, u.name
      LIMIT 100`,
    [orgId],
  );
  return result.rows;
}
