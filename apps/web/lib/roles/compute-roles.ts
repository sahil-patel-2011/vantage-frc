import type { PoolClient } from "@neondatabase/serverless";
import { sortRoles, summarizeRoles } from ".";
import { canonicalHolderName, resolveRoleHolder, unlinkedHolders } from "./holders";
import { loadRoster } from "../work-items/service";
import type { RosterMember } from "../presence/match-names";
import type { RolesSummary, Subteam, TeamRole } from "./types";

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
      summary: RolesSummary;
      members: Array<{ userId: string; name: string }>;
      /** Named holders that did not resolve to exactly one member — a mentor decides these. */
      unlinkedHolders: Array<{ id: string; title: string; holderName: string; holderLink: string }>;
      canManage: boolean;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type RoleRow = {
  id: string;
  title: string;
  subteam: Subteam;
  holderName: string | null;
  holderUserId: string | null;
  isLead: boolean;
  responsibilities: string | null;
  notes: string | null;
  seasonYear: number;
};

function mapRole(row: RoleRow, roster: RosterMember[]): TeamRole {
  const holder = resolveRoleHolder(row.holderName, roster);
  const storedMember = row.holderUserId
    ? roster.find((member) => member.userId === row.holderUserId) ?? null
    : null;
  return {
    id: row.id,
    title: row.title,
    subteam: row.subteam,
    holderName: storedMember?.name?.trim() || holder.holderName,
    holderUserId: storedMember?.userId ?? holder.holderUserId,
    holderLink: storedMember ? "member" : holder.holderLink,
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

  const [roleResult, seasonResult, roster] = await Promise.all([
    client.query<RoleRow>(
      `SELECT id, title, subteam, holder_name AS "holderName",
              holder_user_id AS "holderUserId", is_lead AS "isLead",
              responsibilities, notes, season_year AS "seasonYear"
       FROM team_roles WHERE org_id = $1 AND season_year = $2`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM team_roles WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
    // No `.catch(() => [])` here. loadRoster reads memberships JOIN users — the
    // tables RLS itself is built on, never optional — so the only way it fails is
    // that something earlier already aborted the transaction. Swallowing that gave
    // an empty roster, which downstream is not "degraded" but wrong: unresolved
    // holder names, and createRole/updateRole rejecting a real member with
    // "Holder must be a member of this workspace". Let it surface.
    loadRoster(client, org.orgId),
  ]);

  const roles = sortRoles(roleResult.rows.map((row) => mapRole(row, roster)));
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    roles,
    summary: summarizeRoles(roles),
    members: roster
      .filter((member): member is { userId: string; name: string } => Boolean(member.name?.trim()))
      .map((member) => ({ userId: member.userId, name: member.name.trim() })),
    unlinkedHolders: unlinkedHolders(roles),
    canManage: org.role === "owner" || org.role === "admin",
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createRole(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    title: string;
    subteam: Subteam;
    holderUserId: string | null;
    holderName: string | null;
    isLead: boolean;
    responsibilities: string | null;
  },
): Promise<void> {
  const roster = await loadRoster(client, input.orgId);
  const member = input.holderUserId
    ? roster.find((candidate) => candidate.userId === input.holderUserId)
    : null;
  if (input.holderUserId && !member) throw new Error("Holder must be a member of this workspace");
  const holderName = member?.name?.trim() || canonicalHolderName(input.holderName, roster);
  await client.query(
    `INSERT INTO team_roles
       (org_id, season_year, title, subteam, holder_name, holder_user_id, is_lead, responsibilities, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      input.orgId,
      input.seasonYear,
      input.title,
      input.subteam,
      holderName,
      member?.userId ?? null,
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
    holderUserId?: string | null;
    holderName?: string | null;
    isLead?: boolean;
    responsibilities?: string | null;
    notes?: string | null;
  },
): Promise<void> {
  const changingHolder = input.holderName !== undefined || input.holderUserId !== undefined;
  const roster = changingHolder ? await loadRoster(client, input.orgId) : [];
  const member = input.holderUserId
    ? roster.find((candidate) => candidate.userId === input.holderUserId)
    : null;
  if (input.holderUserId && !member) throw new Error("Holder must be a member of this workspace");
  const holderName = member?.name?.trim() || canonicalHolderName(input.holderName ?? null, roster);
  await client.query(
    `UPDATE team_roles SET
       title = COALESCE($3, title),
       subteam = COALESCE($4, subteam),
       holder_name = CASE WHEN $5::boolean THEN $6 ELSE holder_name END,
       holder_user_id = CASE WHEN $5::boolean THEN $7::uuid ELSE holder_user_id END,
       is_lead = COALESCE($8, is_lead),
       responsibilities = CASE WHEN $9::boolean THEN $10 ELSE responsibilities END,
       notes = CASE WHEN $11::boolean THEN $12 ELSE notes END,
       updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [
      input.roleId,
      input.orgId,
      input.title ?? null,
      input.subteam ?? null,
      changingHolder,
      holderName,
      member?.userId ?? null,
      input.isLead ?? null,
      input.responsibilities !== undefined,
      input.responsibilities ?? null,
      input.notes !== undefined,
      input.notes ?? null,
    ],
  );
}

export async function deleteRole(client: PoolClient, input: { orgId: string; roleId: string }): Promise<void> {
  await client.query(`DELETE FROM team_roles WHERE id = $1 AND org_id = $2`, [input.roleId, input.orgId]);
}
