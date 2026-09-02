import type { PoolClient } from "@neondatabase/serverless";
import { resolveRoleHolders, sortRoles, summarizeRoles } from ".";
import type { RoleHolder, RoleMember, RolesSummary, Subteam, TeamRole } from "./types";

export const SUBTEAMS: Subteam[] = [
  "mechanical",
  "electrical",
  "programming",
  "cad",
  "controls",
  "business",
  "drive_team",
  "scouting",
  "media",
  "safety",
  "other",
];

export type RolesSetupStep = { id: string; label: string; detail: string; href: string };

export type RolesView =
  | {
      status: "setup_required";
      message: string;
      steps: RolesSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      roles: TeamRole[];
      /** Roster for the holder picker — real memberships only. */
      members: RoleMember[];
      /** Owner/admin may add, edit, and delete roles. Everyone reads. */
      canManage: boolean;
      summary: RolesSummary;
      computedAt: string;
    };

/** Compact shape for `GET /api/roles?resolve=1` — who holds what, by account. */
export type RoleHoldersView =
  | { status: "setup_required"; orgId: string | null; seasonYear: number; holders: [] }
  | { status: "live"; orgId: string; seasonYear: number; holders: RoleHolder[] };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type RoleRow = {
  id: string;
  title: string;
  subteam: Subteam;
  holderUserId: string | null;
  holderName: string | null;
  isLead: boolean;
  responsibilities: string | null;
  notes: string | null;
  seasonYear: number;
};

function mapRole(row: RoleRow): TeamRole {
  return {
    id: row.id,
    title: row.title,
    subteam: row.subteam,
    holderUserId: row.holderUserId,
    holderName: row.holderName,
    isLead: Boolean(row.isLead),
    responsibilities: row.responsibilities,
    notes: row.notes,
    seasonYear: row.seasonYear,
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null; role: string } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null; role: string }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber", m.role::text AS role
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

const ROLE_SELECT = `
  SELECT r.id, r.title, r.subteam, r.holder_user_id AS "holderUserId",
         COALESCE(NULLIF(btrim(u.name), ''), u.email, r.holder_name) AS "holderName",
         r.is_lead AS "isLead", r.responsibilities, r.notes, r.season_year AS "seasonYear"
  FROM team_roles r
  LEFT JOIN users u ON u.id = r.holder_user_id
  WHERE r.org_id = $1::uuid AND r.season_year = $2`;

export async function loadRoleMembers(client: PoolClient, orgId: string): Promise<RoleMember[]> {
  const rows = await client.query<RoleMember>(
    `SELECT m.user_id::text AS "userId",
            COALESCE(NULLIF(btrim(u.name), ''), u.email) AS name,
            u.email, m.role::text AS role
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1::uuid
     ORDER BY lower(COALESCE(NULLIF(btrim(u.name), ''), u.email)), m.user_id`,
    [orgId],
  );
  return rows.rows;
}

export async function computeRolesView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<RolesView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to map roles and responsibilities.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [roleResult, seasonResult, members] = await Promise.all([
    client.query<RoleRow>(ROLE_SELECT, [org.orgId, seasonYear]),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM team_roles WHERE org_id = $1::uuid ORDER BY season_year DESC`,
      [org.orgId],
    ),
    loadRoleMembers(client, org.orgId),
  ]);

  const roles = sortRoles(roleResult.rows.map(mapRole));
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    roles,
    members,
    canManage: org.role === "owner" || org.role === "admin",
    summary: summarizeRoles(roles),
    computedAt: new Date().toISOString(),
  };
}

/** `GET /api/roles?resolve=1`: holders as {userId, name} for other features. */
export async function computeRoleHolders(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<RoleHoldersView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();
  if (!org) return { status: "setup_required", orgId: null, seasonYear, holders: [] };
  const [roleResult, members] = await Promise.all([
    client.query<RoleRow>(ROLE_SELECT, [org.orgId, seasonYear]),
    loadRoleMembers(client, org.orgId),
  ]);
  return {
    status: "live",
    orgId: org.orgId,
    seasonYear,
    holders: resolveRoleHolders(sortRoles(roleResult.rows.map(mapRole)), members),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

async function assertHolderMember(client: PoolClient, orgId: string, holderUserId: string | null | undefined) {
  if (!holderUserId) return;
  const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`, [
    orgId,
    holderUserId,
  ]);
  if (!member.rowCount) throw new Error("Role holder must be a member of this organization");
}

export async function createRole(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    title: string;
    subteam: Subteam;
    holderUserId?: string | null;
    holderName: string | null;
    isLead: boolean;
    responsibilities: string | null;
  },
): Promise<void> {
  await assertHolderMember(client, input.orgId, input.holderUserId);
  await client.query(
    `INSERT INTO team_roles
       (org_id, season_year, title, subteam, holder_user_id, holder_name, is_lead, responsibilities, created_by)
     VALUES ($1::uuid,$2,$3,$4,$5::uuid,$6,$7,$8,$9::uuid)`,
    [
      input.orgId,
      input.seasonYear,
      input.title,
      input.subteam,
      input.holderUserId ?? null,
      // A member holder needs no label; keep the free text only for non-members.
      input.holderUserId ? null : input.holderName,
      input.isLead,
      input.responsibilities,
      input.userId,
    ],
  );
}

export async function updateRole(
  client: PoolClient,
  input: {
    orgId: string;
    roleId: string;
    title?: string;
    subteam?: Subteam;
    /** undefined = leave alone; null = clear the member link. */
    holderUserId?: string | null;
    /** undefined = leave alone; null = clear the free-text label. */
    holderName?: string | null;
    isLead?: boolean;
    responsibilities?: string | null;
    notes?: string | null;
  },
): Promise<void> {
  await assertHolderMember(client, input.orgId, input.holderUserId);
  // Setting a member holder clears any stale free-text label, and vice versa,
  // so a role never shows two different people.
  const setHolderUser = input.holderUserId !== undefined;
  const setHolderName = input.holderName !== undefined || Boolean(input.holderUserId);
  const holderName = input.holderUserId ? null : (input.holderName ?? null);
  const setHolderUserFromName = !setHolderUser && input.holderName !== undefined && Boolean(input.holderName);
  await client.query(
    `UPDATE team_roles SET
       title = COALESCE($3, title),
       subteam = COALESCE($4, subteam),
       holder_user_id = CASE WHEN $5::boolean THEN $6::uuid WHEN $12::boolean THEN NULL ELSE holder_user_id END,
       holder_name = CASE WHEN $7::boolean THEN $8 ELSE holder_name END,
       is_lead = COALESCE($9, is_lead),
       responsibilities = CASE WHEN $10::boolean THEN $11 ELSE responsibilities END,
       notes = CASE WHEN $13::boolean THEN $14 ELSE notes END,
       updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [
      input.roleId,
      input.orgId,
      input.title ?? null,
      input.subteam ?? null,
      setHolderUser,
      input.holderUserId ?? null,
      setHolderName,
      holderName,
      input.isLead ?? null,
      input.responsibilities !== undefined,
      input.responsibilities ?? null,
      setHolderUserFromName,
      input.notes !== undefined,
      input.notes ?? null,
    ],
  );
}

export async function deleteRole(client: PoolClient, input: { orgId: string; roleId: string }): Promise<void> {
  await client.query(`DELETE FROM team_roles WHERE id = $1::uuid AND org_id = $2::uuid`, [input.roleId, input.orgId]);
}
