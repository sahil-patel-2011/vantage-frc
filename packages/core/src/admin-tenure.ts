import type { PoolClient } from "@neondatabase/serverless";

/** Days after org creation where Soft-UI nudges a co-admin (ends earlier if ≥2 admins). */
export const ADMIN_TENURE_BOOTSTRAP_DAYS = 14;

export type PrivilegedOrgRole = "owner" | "admin";

export function isPrivilegedOrgRole(role: string): role is PrivilegedOrgRole {
  return role === "owner" || role === "admin";
}

export type AdminTenureSnapshot = {
  orgCreatedAt: string;
  adminCount: number;
  bootstrapActive: boolean;
  daysRemaining: number | null;
  lastAdminLocked: boolean;
  /** Soft-UI invite / demotion copy — null when no special messaging needed. */
  inviteHint: string | null;
};

export function computeAdminTenure(input: {
  orgCreatedAt: Date | string;
  adminCount: number;
  now?: Date;
}): Omit<AdminTenureSnapshot, "orgCreatedAt" | "adminCount"> & {
  orgCreatedAt: string;
  adminCount: number;
} {
  const created = new Date(input.orgCreatedAt);
  const now = input.now ?? new Date();
  const ageMs = Math.max(0, now.getTime() - created.getTime());
  const ageDays = ageMs / (24 * 3_600_000);
  const withinWindow = ageDays < ADMIN_TENURE_BOOTSTRAP_DAYS;
  const hasSecondAdmin = input.adminCount >= 2;
  const bootstrapActive = withinWindow && !hasSecondAdmin;
  const daysRemaining = bootstrapActive
    ? Math.max(1, Math.ceil(ADMIN_TENURE_BOOTSTRAP_DAYS - ageDays))
    : null;
  const lastAdminLocked = input.adminCount <= 1;

  let inviteHint: string | null = null;
  if (bootstrapActive) {
    inviteHint =
      `This team is in its first ${ADMIN_TENURE_BOOTSTRAP_DAYS} days with a single admin ` +
      `(about ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left in the bootstrap window). ` +
      `Invite a co-admin so ownership isn’t a single point of failure. ` +
      `Teams must always keep at least one owner or admin.`;
  } else if (lastAdminLocked) {
    inviteHint =
      "Teams must keep at least one owner or admin. Invite a co-admin before demoting the last one.";
  }

  return {
    orgCreatedAt: created.toISOString(),
    adminCount: input.adminCount,
    bootstrapActive,
    daysRemaining,
    lastAdminLocked,
    inviteHint,
  };
}

/**
 * Blocks demoting the last owner/admin. Always enforced — bootstrap Soft-UI is separate.
 */
export function assertRoleChangeKeepsAdmin(input: {
  adminCount: number;
  targetIsPrivileged: boolean;
  nextRole: string;
}): void {
  if (!input.targetIsPrivileged) return;
  if (isPrivilegedOrgRole(input.nextRole)) return;
  if (input.adminCount <= 1) {
    throw new Error(
      "Teams must keep at least one owner or admin. Promote or invite another admin before demoting the last one.",
    );
  }
}

export async function countPrivilegedMembers(client: PoolClient, orgId: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM memberships
     WHERE org_id = $1::uuid AND role IN ('owner', 'admin')`,
    [orgId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function getAdminTenureSnapshot(
  client: PoolClient,
  orgId: string,
  now?: Date,
): Promise<AdminTenureSnapshot> {
  const org = await client.query<{ createdAt: Date }>(
    `SELECT created_at AS "createdAt" FROM organizations WHERE id = $1::uuid`,
    [orgId],
  );
  if (!org.rows[0]) throw new Error("Organization not found");
  const adminCount = await countPrivilegedMembers(client, orgId);
  return computeAdminTenure({
    orgCreatedAt: org.rows[0].createdAt,
    adminCount,
    now,
  });
}

export async function assertAdminTenureAllowsRoleChange(
  client: PoolClient,
  input: { orgId: string; targetCurrentRole: string; nextRole: string },
): Promise<void> {
  if (!isPrivilegedOrgRole(input.targetCurrentRole)) return;
  if (isPrivilegedOrgRole(input.nextRole)) return;
  const adminCount = await countPrivilegedMembers(client, input.orgId);
  assertRoleChangeKeepsAdmin({
    adminCount,
    targetIsPrivileged: true,
    nextRole: input.nextRole,
  });
}
