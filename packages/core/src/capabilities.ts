import type { PoolClient } from "@neondatabase/serverless";
import { assertAdminTenureAllowsRoleChange } from "./admin-tenure";
import { hashEmail } from "./email";

type OrgRole = "owner" | "admin" | "scout" | "viewer";

export const ORG_CAPABILITIES = [
  "manage_api_keys",
  "manage_team_settings",
  "manage_members",
  "manage_billing",
] as const;

export type OrgCapability = (typeof ORG_CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<OrgCapability, { title: string; description: string }> = {
  manage_api_keys: {
    title: "Manage API keys / connectors",
    description: "BYOK providers, TBA connectors, API budgets, and model routing controls.",
  },
  manage_team_settings: {
    title: "Manage team settings",
    description: "Authentication policy, active event context, and org preference toggles.",
  },
  manage_members: {
    title: "Manage members / invites",
    description: "Send, resend, and revoke invites. Does not grant capability admin rights.",
  },
  manage_billing: {
    title: "Manage billing",
    description: "Checkout and billing portal. Off by default — only owners may grant this.",
  },
};

function isCapability(value: string): value is OrgCapability {
  return (ORG_CAPABILITIES as readonly string[]).includes(value);
}

async function auditMembership(
  client: PoolClient,
  input: {
    orgId: string;
    actorUserId: string;
    action: string;
    email?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO membership_audit_events(
      org_id,actor_user_id,action,target_email_hash,metadata
    ) VALUES($1,$2,$3,$4,$5::jsonb)`,
    [
      input.orgId,
      input.actorUserId,
      input.action,
      input.email ? hashEmail(input.email) : null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export async function assertOrgCapability(
  client: PoolClient,
  orgId: string,
  capability: OrgCapability,
): Promise<void> {
  const result = await client.query<{ allowed: boolean }>(
    `SELECT has_org_capability($1::uuid, $2::org_capability) AS allowed`,
    [orgId, capability],
  );
  if (!result.rows[0]?.allowed) {
    throw new Error("Organization administrator access required");
  }
}

export async function listOrganizationMembers(
  client: PoolClient,
  orgId: string,
): Promise<
  Array<{
    userId: string;
    name: string;
    email: string;
    role: OrgRole;
    capabilities: OrgCapability[];
    joinedAt: string;
  }>
> {
  const members = await client.query<{
    userId: string;
    name: string;
    email: string;
    role: OrgRole;
    joinedAt: Date;
  }>(
    `SELECT m.user_id AS "userId", u.name, u.email, m.role, m.created_at AS "joinedAt"
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1
     ORDER BY
       CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'scout' THEN 2 ELSE 3 END,
       u.name ASC`,
    [orgId],
  );
  const caps = await client.query<{ userId: string; capability: OrgCapability }>(
    `SELECT user_id AS "userId", capability
     FROM membership_capabilities
     WHERE org_id = $1`,
    [orgId],
  );
  const byUser = new Map<string, OrgCapability[]>();
  for (const row of caps.rows) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row.capability);
    byUser.set(row.userId, list);
  }
  return members.rows.map((member) => ({
    ...member,
    joinedAt: member.joinedAt.toISOString(),
    capabilities: byUser.get(member.userId) ?? [],
  }));
}

export async function setMemberCapabilities(
  client: PoolClient,
  actorUserId: string,
  input: {
    orgId: string;
    userId: string;
    capabilities: OrgCapability[];
  },
) {
  const actor = await client.query<{ role: OrgRole }>(
    `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2`,
    [input.orgId, actorUserId],
  );
  if (!actor.rows[0] || !["owner", "admin"].includes(actor.rows[0].role)) {
    throw new Error("Organization administrator access required");
  }

  const target = await client.query<{ role: OrgRole; email: string }>(
    `SELECT m.role, u.email
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1 AND m.user_id = $2`,
    [input.orgId, input.userId],
  );
  if (!target.rows[0]) throw new Error("Member not found");
  if (["owner", "admin"].includes(target.rows[0].role)) {
    throw new Error("Owners and admins already have full admin capabilities");
  }

  const unique = [...new Set(input.capabilities)];
  for (const capability of unique) {
    if (!isCapability(capability)) throw new Error(`Unknown capability: ${capability}`);
    if (capability === "manage_billing" && actor.rows[0].role !== "owner") {
      throw new Error("Only an owner may grant billing management");
    }
  }

  const before = await client.query<{ capability: OrgCapability }>(
    `SELECT capability FROM membership_capabilities WHERE org_id = $1 AND user_id = $2`,
    [input.orgId, input.userId],
  );

  await client.query(
    `DELETE FROM membership_capabilities WHERE org_id = $1 AND user_id = $2`,
    [input.orgId, input.userId],
  );
  for (const capability of unique) {
    await client.query(
      `INSERT INTO membership_capabilities(org_id, user_id, capability, granted_by)
       VALUES ($1, $2, $3::org_capability, $4)`,
      [input.orgId, input.userId, capability, actorUserId],
    );
  }

  await auditMembership(client, {
    orgId: input.orgId,
    actorUserId,
    action: "member.capabilities.updated",
    email: target.rows[0].email,
    metadata: {
      userId: input.userId,
      before: before.rows.map((row) => row.capability),
      after: unique,
    },
  });
}

export async function setMemberRole(
  client: PoolClient,
  actorUserId: string,
  input: { orgId: string; userId: string; role: OrgRole },
) {
  if (!["admin", "scout", "viewer"].includes(input.role)) {
    throw new Error("Role must be admin, scout, or viewer");
  }

  const actor = await client.query<{ role: OrgRole }>(
    `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2`,
    [input.orgId, actorUserId],
  );
  if (!actor.rows[0] || !["owner", "admin"].includes(actor.rows[0].role)) {
    throw new Error("Organization administrator access required");
  }

  const target = await client.query<{ role: OrgRole; email: string }>(
    `SELECT m.role, u.email
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1 AND m.user_id = $2`,
    [input.orgId, input.userId],
  );
  if (!target.rows[0]) throw new Error("Member not found");
  if (target.rows[0].role === "owner") {
    throw new Error("Owner role cannot be changed here");
  }
  if (input.userId === actorUserId) {
    throw new Error("You cannot change your own role");
  }
  if (target.rows[0].role === "admin" && actor.rows[0].role !== "owner") {
    throw new Error("Only an owner may change another admin's role");
  }

  await assertAdminTenureAllowsRoleChange(client, {
    orgId: input.orgId,
    targetCurrentRole: target.rows[0].role,
    nextRole: input.role,
  });

  const previousRole = target.rows[0].role;
  await client.query(
    `UPDATE memberships SET role = $3::org_role WHERE org_id = $1 AND user_id = $2`,
    [input.orgId, input.userId, input.role],
  );

  if (input.role === "admin") {
    await client.query(
      `DELETE FROM membership_capabilities WHERE org_id = $1 AND user_id = $2`,
      [input.orgId, input.userId],
    );
  }

  await auditMembership(client, {
    orgId: input.orgId,
    actorUserId,
    action: input.role === "admin" ? "member.promoted_admin" : "member.role.updated",
    email: target.rows[0].email,
    metadata: { userId: input.userId, before: previousRole, after: input.role },
  });
}
