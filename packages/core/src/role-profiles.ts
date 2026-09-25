import type { PoolClient } from "@neondatabase/serverless";
import { ORG_CAPABILITIES, setMemberCapabilities, setMemberRole, type OrgCapability } from "./capabilities";
import {
  HUB_ACCESS_HUB_IDS,
  setMemberHubAccess,
  type HubAccessHubId,
  type MemberHubAccessRow,
} from "./hub-access";

/**
 * Permission profiles: a named bundle of "role + capabilities + which hubs".
 *
 * Teams do not think in capability checkboxes, they think in jobs — team lead,
 * drive coach, business captain, first-year scout. Before this, giving someone
 * that job meant an admin reproducing the same handful of toggles from memory on
 * every member, and two leads quietly ending up with different access.
 *
 * Applying a profile writes nothing new: it calls the ordinary
 * setMemberRole / setMemberCapabilities / setMemberHubAccess paths, so the
 * existing RLS policies and capability assertions remain the only thing that
 * authorizes a request, every change is audited where it already was, and a
 * profile edited later does not retroactively change anyone's access — it is a
 * preset, not a live grant. That is a deliberate trade: predictable, auditable,
 * and impossible to get out of sync with what the database actually enforces.
 */

export type RoleProfileBaseRole = "admin" | "scout" | "viewer";

export type RoleProfile = {
  id: string;
  key: string;
  name: string;
  description: string;
  baseRole: RoleProfileBaseRole;
  capabilities: OrgCapability[];
  /** {} means unrestricted. A hub mapped to [] means the whole hub. */
  hubAccess: Record<string, string[]>;
  updatedAt: string;
};

export type RoleProfileInput = {
  key: string;
  name: string;
  description?: string;
  baseRole: RoleProfileBaseRole;
  capabilities?: string[];
  hubAccess?: Record<string, string[]>;
};

/**
 * The four jobs almost every FRC team has, seeded once so a new team starts with
 * something to apply instead of an empty page. They are ordinary rows after
 * seeding: rename them, retune them, delete them.
 */
export const STARTER_ROLE_PROFILES: readonly RoleProfileInput[] = [
  {
    key: "team-lead",
    name: "Team lead",
    description:
      // Says what the access really is: "No billing, no API keys" was not true of admin access.
      "A student captain with a mentor's access: runs the calendar, people and the playbook, invites members and can change team settings.",
    baseRole: "admin",
  },
  {
    key: "drive-coach",
    name: "Drive coach",
    description: "Everything at an event — scouting, strategy, the pit — and nothing in money or settings.",
    baseRole: "scout",
    hubAccess: { competition: [], build: [] },
  },
  {
    key: "business-captain",
    name: "Business captain",
    description: "Sponsors, grants, the budget and outreach, plus the team calendar and files.",
    baseRole: "scout",
    hubAccess: { business: [], team: [] },
  },
  {
    key: "scout",
    name: "Scout",
    description: "Match and pit forms at an event. Read-only everywhere else in Competition.",
    baseRole: "scout",
    hubAccess: { competition: ["scouting", "event-day"] },
  },
] as const;

const isCapability = (value: string): value is OrgCapability =>
  (ORG_CAPABILITIES as readonly string[]).includes(value);

const isHubId = (value: string): value is HubAccessHubId =>
  (HUB_ACCESS_HUB_IDS as readonly string[]).includes(value);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Clean a profile before it reaches the table.
 *
 * Unknown capabilities and unknown hub ids are dropped rather than rejected: the
 * hub list and capability enum grow between releases, and a profile saved by a
 * newer tab should not hard-fail an older server — the guarantee that matters is
 * that nothing unrecognised is ever stored.
 */
function normalize(input: RoleProfileInput): Required<Omit<RoleProfileInput, "description">> & {
  description: string;
} {
  const key = slugify(input.key || input.name);
  if (!key) throw new Error("A profile needs a name");
  const name = input.name.trim();
  if (!name) throw new Error("A profile needs a name");
  if (!["admin", "scout", "viewer"].includes(input.baseRole)) {
    throw new Error("Base role must be admin, scout, or viewer");
  }
  // Owners and admins already hold every capability and cannot be hub-restricted,
  // so storing either for an admin profile would promise a limit we do not apply.
  const isAdmin = input.baseRole === "admin";
  const capabilities = isAdmin ? [] : [...new Set(input.capabilities ?? [])].filter(isCapability);
  const hubAccess: Record<string, string[]> = {};
  if (!isAdmin) {
    for (const [hubId, tabs] of Object.entries(input.hubAccess ?? {})) {
      if (!isHubId(hubId)) continue;
      hubAccess[hubId] = [...new Set(Array.isArray(tabs) ? tabs.filter((tab) => typeof tab === "string") : [])];
    }
  }
  return {
    key,
    name,
    description: (input.description ?? "").trim().slice(0, 280),
    baseRole: input.baseRole,
    capabilities,
    hubAccess,
  };
}

type Row = {
  id: string;
  key: string;
  name: string;
  description: string;
  baseRole: RoleProfileBaseRole;
  capabilities: OrgCapability[] | null;
  hubAccess: Record<string, string[]> | null;
  updatedAt: Date;
};

/**
 * `capabilities` is an `org_capability[]` — an array of a custom Postgres enum —
 * and node-postgres only parses arrays of types it knows. A custom enum array
 * arrives as the literal string "{manage_api_keys,view_billing}", and `?? []`
 * lets a string straight through. The admin page then called `.map` on it and
 * the whole Team admin screen crashed for every team with a profile — which is
 * the screen owners invite teammates from.
 *
 * The queries cast to `text[]`, which the driver does parse. This is the second
 * line: whatever shape arrives, a list of known capabilities leaves.
 */
export function asCapabilities(value: unknown): OrgCapability[] {
  let items: unknown[] = [];
  if (Array.isArray(value)) items = value;
  else if (typeof value === "string") {
    const inner = value.trim().replace(/^\{|\}$/g, "");
    items = inner ? inner.split(",").map((part) => part.trim().replace(/^"|"$/g, "")) : [];
  }
  return items.filter((item): item is OrgCapability => typeof item === "string" && isCapability(item));
}

const toProfile = (row: Row): RoleProfile => ({
  id: row.id,
  key: row.key,
  name: row.name,
  description: row.description,
  baseRole: row.baseRole,
  capabilities: asCapabilities(row.capabilities),
  hubAccess: row.hubAccess ?? {},
  updatedAt: row.updatedAt.toISOString(),
});

export async function listRoleProfiles(client: PoolClient, orgId: string): Promise<RoleProfile[]> {
  const result = await client.query<Row>(
    `SELECT id, key, name, description, base_role AS "baseRole",
            capabilities::text[] AS capabilities, hub_access AS "hubAccess", updated_at AS "updatedAt"
     FROM org_role_profiles
     WHERE org_id = $1
     ORDER BY CASE base_role WHEN 'admin' THEN 0 WHEN 'scout' THEN 1 ELSE 2 END, name ASC`,
    [orgId],
  );
  return result.rows.map(toProfile);
}

/** Seed the starter set once. Safe to call on every admin load. */
export async function ensureStarterRoleProfiles(
  client: PoolClient,
  orgId: string,
  actorUserId: string,
): Promise<void> {
  const existing = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM org_role_profiles WHERE org_id = $1`,
    [orgId],
  );
  if (Number(existing.rows[0]?.count ?? "0") > 0) return;
  for (const starter of STARTER_ROLE_PROFILES) {
    await saveRoleProfile(client, actorUserId, orgId, starter);
  }
}

export async function saveRoleProfile(
  client: PoolClient,
  actorUserId: string,
  orgId: string,
  input: RoleProfileInput,
): Promise<RoleProfile> {
  const profile = normalize(input);
  const result = await client.query<Row>(
    `INSERT INTO org_role_profiles(
       org_id, key, name, description, base_role, capabilities, hub_access, created_by
     ) VALUES ($1,$2,$3,$4,$5::org_role,$6::org_capability[],$7::jsonb,$8)
     ON CONFLICT (org_id, key) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       base_role = EXCLUDED.base_role,
       capabilities = EXCLUDED.capabilities,
       hub_access = EXCLUDED.hub_access,
       updated_at = now()
     RETURNING id, key, name, description, base_role AS "baseRole",
               capabilities::text[] AS capabilities, hub_access AS "hubAccess", updated_at AS "updatedAt"`,
    [
      orgId,
      profile.key,
      profile.name,
      profile.description,
      profile.baseRole,
      profile.capabilities,
      JSON.stringify(profile.hubAccess),
      actorUserId,
    ],
  );
  return toProfile(result.rows[0]!);
}

export async function deleteRoleProfile(client: PoolClient, orgId: string, key: string): Promise<void> {
  await client.query(`DELETE FROM org_role_profiles WHERE org_id = $1 AND key = $2`, [orgId, key]);
}

/**
 * Apply a profile to one member.
 *
 * Order matters: the role is written first because the capability and
 * hub-access writers refuse to touch an owner or admin — a member being promoted
 * to an admin profile must therefore have their old per-member restrictions
 * cleared *before* the promotion lands, or they would keep an allowlist nobody
 * can edit afterwards.
 */
export async function applyRoleProfile(
  client: PoolClient,
  actorUserId: string,
  input: { orgId: string; userId: string; key: string },
): Promise<RoleProfile> {
  const found = await client.query<Row>(
    `SELECT id, key, name, description, base_role AS "baseRole",
            capabilities::text[] AS capabilities, hub_access AS "hubAccess", updated_at AS "updatedAt"
     FROM org_role_profiles WHERE org_id = $1 AND key = $2`,
    [input.orgId, input.key],
  );
  if (!found.rows[0]) throw new Error("That role profile no longer exists");
  const profile = toProfile(found.rows[0]);

  const current = await client.query<{ role: string }>(
    `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2`,
    [input.orgId, input.userId],
  );
  if (!current.rows[0]) throw new Error("Member not found");
  const wasRestrictable = current.rows[0].role === "scout" || current.rows[0].role === "viewer";

  if (profile.baseRole === "admin" && wasRestrictable) {
    await setMemberCapabilities(client, actorUserId, { orgId: input.orgId, userId: input.userId, capabilities: [] });
    await setMemberHubAccess(client, actorUserId, { orgId: input.orgId, userId: input.userId, access: [] });
  }

  if (current.rows[0].role !== profile.baseRole) {
    await setMemberRole(client, actorUserId, {
      orgId: input.orgId,
      userId: input.userId,
      role: profile.baseRole,
    });
  }

  if (profile.baseRole !== "admin") {
    await setMemberCapabilities(client, actorUserId, {
      orgId: input.orgId,
      userId: input.userId,
      capabilities: profile.capabilities,
    });
    const access: MemberHubAccessRow[] = Object.entries(profile.hubAccess)
      .filter(([hubId]) => isHubId(hubId))
      .map(([hubId, tabs]) => ({ hubId: hubId as HubAccessHubId, allowedTabIds: tabs }));
    await setMemberHubAccess(client, actorUserId, { orgId: input.orgId, userId: input.userId, access });
  }

  return profile;
}
