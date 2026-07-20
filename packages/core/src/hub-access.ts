import type { PoolClient } from "@neondatabase/serverless";
import { hashEmail } from "./email";

export const HUB_ACCESS_HUB_IDS = [
  "competition",
  "team",
  "business",
  "build",
  "ai",
  "media",
] as const;

export type HubAccessHubId = (typeof HUB_ACCESS_HUB_IDS)[number];

export type MemberHubAccessRow = {
  hubId: HubAccessHubId;
  allowedTabIds: string[];
};

export type MemberHubAccessMap = Record<string, string[]>;

/** Always reachable even when hub allowlists are active. */
export const HUB_ACCESS_ALWAYS_HREFS = new Set([
  "/dashboard",
  "/account",
  "/security",
  "/help",
  "/notifications",
  "/support",
  "/start",
  "/workspace",
  "/onboarding",
  "/signin",
  "/sign-in",
]);

function isHubId(value: string): value is HubAccessHubId {
  return (HUB_ACCESS_HUB_IDS as readonly string[]).includes(value);
}

async function auditHubAccess(
  client: PoolClient,
  input: {
    orgId: string;
    actorUserId: string;
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
      "member.hub_access.updated",
      input.email ? hashEmail(input.email) : null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

/** Load allowlist rows for one member. Empty array ⇒ unrestricted. */
export async function listMemberHubAccess(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<MemberHubAccessRow[]> {
  const result = await client.query<{ hubId: string; allowedTabIds: string[] | null }>(
    `SELECT hub_id AS "hubId", allowed_tab_ids AS "allowedTabIds"
     FROM membership_hub_access
     WHERE org_id = $1 AND user_id = $2
     ORDER BY hub_id ASC`,
    [orgId, userId],
  );
  return result.rows
    .filter((row): row is { hubId: HubAccessHubId; allowedTabIds: string[] | null } =>
      isHubId(row.hubId),
    )
    .map((row) => ({
      hubId: row.hubId,
      allowedTabIds: Array.isArray(row.allowedTabIds) ? row.allowedTabIds : [],
    }));
}

export function hubAccessToMap(rows: MemberHubAccessRow[]): MemberHubAccessMap | null {
  if (!rows.length) return null;
  const map: MemberHubAccessMap = {};
  for (const row of rows) {
    map[row.hubId] = [...row.allowedTabIds];
  }
  return map;
}

export function memberIsHubUnrestricted(rows: MemberHubAccessRow[]): boolean {
  return rows.length === 0;
}

export function canAccessHub(rows: MemberHubAccessRow[], hubId: HubAccessHubId): boolean {
  if (memberIsHubUnrestricted(rows)) return true;
  return rows.some((row) => row.hubId === hubId);
}

export function canAccessHubTab(
  rows: MemberHubAccessRow[],
  hubId: HubAccessHubId,
  tabId: string,
): boolean {
  if (memberIsHubUnrestricted(rows)) return true;
  const row = rows.find((entry) => entry.hubId === hubId);
  if (!row) return false;
  // Empty allowed_tab_ids means all tabs in that hub.
  if (!row.allowedTabIds.length) return true;
  return row.allowedTabIds.includes(tabId);
}

export async function assertHubTabAccess(
  client: PoolClient,
  orgId: string,
  userId: string,
  hubId: HubAccessHubId,
  tabId?: string,
): Promise<void> {
  const role = await client.query<{ role: string }>(
    `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2`,
    [orgId, userId],
  );
  if (!role.rows[0]) throw new Error("Organization membership required");
  if (role.rows[0].role === "owner" || role.rows[0].role === "admin") return;

  const rows = await listMemberHubAccess(client, orgId, userId);
  if (!canAccessHub(rows, hubId)) {
    throw new Error("You do not have access to this section");
  }
  if (tabId && !canAccessHubTab(rows, hubId, tabId)) {
    throw new Error("You do not have access to this tab");
  }
}

/**
 * Replace allowlist for a member. Pass empty `access` to clear (unrestricted).
 * Owners/admins cannot be restricted.
 */
export async function setMemberHubAccess(
  client: PoolClient,
  actorUserId: string,
  input: {
    orgId: string;
    userId: string;
    access: MemberHubAccessRow[];
  },
) {
  const actor = await client.query<{ role: string }>(
    `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2`,
    [input.orgId, actorUserId],
  );
  if (!actor.rows[0] || !["owner", "admin"].includes(actor.rows[0].role)) {
    throw new Error("Organization administrator access required");
  }

  const target = await client.query<{ role: string; email: string }>(
    `SELECT m.role, u.email
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1 AND m.user_id = $2`,
    [input.orgId, input.userId],
  );
  if (!target.rows[0]) throw new Error("Member not found");
  if (["owner", "admin"].includes(target.rows[0].role)) {
    throw new Error("Owners and admins cannot be restricted to sections");
  }

  const normalized: MemberHubAccessRow[] = [];
  const seen = new Set<string>();
  for (const entry of input.access) {
    if (!isHubId(entry.hubId)) throw new Error(`Unknown hub: ${entry.hubId}`);
    if (seen.has(entry.hubId)) continue;
    seen.add(entry.hubId);
    const tabs = [...new Set((entry.allowedTabIds ?? []).map((t) => t.trim()).filter(Boolean))];
    normalized.push({ hubId: entry.hubId, allowedTabIds: tabs });
  }

  const before = await listMemberHubAccess(client, input.orgId, input.userId);

  await client.query(`DELETE FROM membership_hub_access WHERE org_id = $1 AND user_id = $2`, [
    input.orgId,
    input.userId,
  ]);

  for (const row of normalized) {
    await client.query(
      `INSERT INTO membership_hub_access(org_id, user_id, hub_id, allowed_tab_ids, granted_by)
       VALUES ($1, $2, $3, $4::text[], $5)`,
      [input.orgId, input.userId, row.hubId, row.allowedTabIds, actorUserId],
    );
  }

  await auditHubAccess(client, {
    orgId: input.orgId,
    actorUserId,
    email: target.rows[0].email,
    metadata: {
      userId: input.userId,
      before,
      after: normalized,
    },
  });
}

/** Org funding flags used to adapt Business Soft-UI. Null sponsors_allowed ⇒ show sponsors. */
export type OrgFundingProfile = {
  teamAffiliation: "private_school" | "public_school" | "community" | null;
  schoolFunded: boolean | null;
  outsideGrants: boolean | null;
  sponsorsAllowed: boolean | null;
};

export function sponsorsUiAllowed(profile: Pick<OrgFundingProfile, "sponsorsAllowed">): boolean {
  return profile.sponsorsAllowed !== false;
}

/** Soft-UI + API guard: org funding profile disallows sponsor tools. */
export async function assertSponsorsAllowed(client: PoolClient, orgId: string): Promise<void> {
  const result = await client.query<{ sponsorsAllowed: boolean | null }>(
    `SELECT sponsors_allowed AS "sponsorsAllowed" FROM organizations WHERE id = $1::uuid`,
    [orgId],
  );
  if (!result.rows[0]) throw new Error("Organization access denied");
  if (!sponsorsUiAllowed({ sponsorsAllowed: result.rows[0].sponsorsAllowed })) {
    throw new Error("Sponsor tools are disabled for this organization");
  }
}