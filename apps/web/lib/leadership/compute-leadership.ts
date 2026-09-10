import type { PoolClient } from "@neondatabase/serverless";
import { computeLeadershipReadiness, summarizeLeadership } from ".";
import type {
  LeadershipCategory,
  LeadershipHandoffStatus,
  LeadershipReadiness,
  LeadershipRole,
  LeadershipSummary,
} from "./types";

export const LEADERSHIP_CATEGORY_VALUES: LeadershipCategory[] = [
  "leadership",
  "technical",
  "mentor",
  "business",
  "safety",
  "other",
];
export const LEADERSHIP_STATUS_VALUES: LeadershipHandoffStatus[] = [
  "not_started",
  "identified",
  "in_training",
  "ready",
  "completed",
];

export type LeadershipSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type LeadershipView =
  | {
      status: "setup_required";
      message: string;
      steps: LeadershipSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      roles: LeadershipRole[];
      summary: LeadershipSummary;
      readiness: LeadershipReadiness;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type RoleRow = {
  id: string;
  roleTitle: string;
  category: LeadershipCategory;
  holderName: string;
  holderUserId: string | null;
  successorName: string | null;
  successorUserId: string | null;
  handoffStatus: LeadershipHandoffStatus;
  targetHandoffDate: string | null;
  notes: string | null;
  seasonYear: number;
  createdAt: string;
  updatedAt: string;
};

function mapRole(row: RoleRow): LeadershipRole {
  return {
    id: row.id,
    roleTitle: row.roleTitle,
    category: row.category,
    holderName: row.holderName,
    holderUserId: row.holderUserId,
    successorName: row.successorName,
    successorUserId: row.successorUserId,
    handoffStatus: row.handoffStatus,
    targetHandoffDate: row.targetHandoffDate,
    notes: row.notes,
    seasonYear: row.seasonYear,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
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

export async function computeLeadershipView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<LeadershipView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to plan leadership succession and role handoffs.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [roleResult, seasonResult] = await Promise.all([
    client.query<RoleRow>(
      `SELECT id, role_title AS "roleTitle", category, holder_name AS "holderName",
              holder_user_id AS "holderUserId", successor_name AS "successorName",
              successor_user_id AS "successorUserId", handoff_status AS "handoffStatus",
              target_handoff_date::text AS "targetHandoffDate", notes, season_year AS "seasonYear",
              created_at::text AS "createdAt", updated_at::text AS "updatedAt"
       FROM leadership_roles
       WHERE org_id = $1 AND season_year = $2
       ORDER BY role_title ASC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM leadership_roles WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const roles = roleResult.rows.map(mapRole);
  const summary = summarizeLeadership(roles);
  const readiness = computeLeadershipReadiness(summary, roles);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    roles,
    summary,
    readiness,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createRole(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    roleTitle: string;
    category: LeadershipCategory;
    holderName: string;
    successorName: string | null;
    handoffStatus: LeadershipHandoffStatus;
    targetHandoffDate: string | null;
    notes: string | null;
    seasonYear: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO leadership_roles (
       org_id, role_title, category, holder_name, successor_name, handoff_status,
       target_handoff_date, notes, season_year, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10)`,
    [
      input.orgId,
      input.roleTitle,
      input.category,
      input.holderName,
      input.successorName,
      input.handoffStatus,
      input.targetHandoffDate,
      input.notes,
      input.seasonYear,
      input.userId,
    ],
  );
}

export async function updateHandoffStatus(
  client: PoolClient,
  input: {
    orgId: string;
    roleId: string;
    handoffStatus: LeadershipHandoffStatus;
    successorName: string | null;
  },
): Promise<void> {
  await client.query(
    `UPDATE leadership_roles
     SET handoff_status = $1, successor_name = $2, updated_at = now()
     WHERE id = $3 AND org_id = $4`,
    [input.handoffStatus, input.successorName, input.roleId, input.orgId],
  );
}

export async function deleteRole(
  client: PoolClient,
  input: { orgId: string; roleId: string },
): Promise<void> {
  await client.query(`DELETE FROM leadership_roles WHERE id = $1 AND org_id = $2`, [
    input.roleId,
    input.orgId,
  ]);
}
