import type { PoolClient } from "@neondatabase/serverless";
import { computeTeamHealthReadiness, summarizeTeamHealth } from ".";
import type { TeamHealthPulse, TeamHealthReadiness, TeamHealthSummary } from "./types";

export type TeamHealthSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type TeamHealthDashboardView =
  | {
      status: "setup_required";
      message: string;
      steps: TeamHealthSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      pulses: TeamHealthPulse[];
      summary: TeamHealthSummary;
      readiness: TeamHealthReadiness;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type PulseRow = {
  id: string;
  periodLabel: string;
  periodStart: string;
  attendanceRate: number;
  membersPresent: number;
  membersTotal: number;
  tasksCompleted: number;
  tasksOpen: number;
  tasksOverdue: number;
  engagementScore: number;
  moraleRating: number;
  seasonYear: number;
  notes: string | null;
};

function mapPulse(row: PulseRow): TeamHealthPulse {
  return {
    id: row.id,
    periodLabel: row.periodLabel,
    periodStart: row.periodStart,
    attendanceRate: Number(row.attendanceRate) || 0,
    membersPresent: Number(row.membersPresent) || 0,
    membersTotal: Number(row.membersTotal) || 0,
    tasksCompleted: Number(row.tasksCompleted) || 0,
    tasksOpen: Number(row.tasksOpen) || 0,
    tasksOverdue: Number(row.tasksOverdue) || 0,
    engagementScore: Number(row.engagementScore) || 0,
    moraleRating: Number(row.moraleRating) || 0,
    seasonYear: row.seasonYear,
    notes: row.notes,
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

export async function computeTeamHealthDashboardView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<TeamHealthDashboardView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to track team health (attendance, tasks, engagement).",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [pulseResult, seasonResult] = await Promise.all([
    client.query<PulseRow>(
      `SELECT id, period_label AS "periodLabel", period_start::text AS "periodStart",
              attendance_rate AS "attendanceRate", members_present AS "membersPresent",
              members_total AS "membersTotal", tasks_completed AS "tasksCompleted",
              tasks_open AS "tasksOpen", tasks_overdue AS "tasksOverdue",
              engagement_score AS "engagementScore", morale_rating AS "moraleRating",
              season_year AS "seasonYear", notes
       FROM team_health_dashboard_pulses
       WHERE org_id = $1 AND season_year = $2
       ORDER BY period_start DESC, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM team_health_dashboard_pulses WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const pulses = pulseResult.rows.map(mapPulse);
  const summary = summarizeTeamHealth(pulses);
  const readiness = computeTeamHealthReadiness(summary);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    pulses,
    summary,
    readiness,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logPulse(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    periodLabel: string;
    periodStart: string;
    attendanceRate: number;
    membersPresent: number;
    membersTotal: number;
    tasksCompleted: number;
    tasksOpen: number;
    tasksOverdue: number;
    engagementScore: number;
    moraleRating: number;
    seasonYear: number;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO team_health_dashboard_pulses (
       org_id, period_label, period_start, attendance_rate, members_present, members_total,
       tasks_completed, tasks_open, tasks_overdue, engagement_score, morale_rating,
       season_year, notes, logged_by
     ) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      input.orgId,
      input.periodLabel,
      input.periodStart,
      Math.min(100, Math.max(0, Math.round(input.attendanceRate))),
      Math.max(0, Math.round(input.membersPresent)),
      Math.max(0, Math.round(input.membersTotal)),
      Math.max(0, Math.round(input.tasksCompleted)),
      Math.max(0, Math.round(input.tasksOpen)),
      Math.max(0, Math.round(input.tasksOverdue)),
      Math.min(100, Math.max(0, Math.round(input.engagementScore))),
      Math.min(5, Math.max(1, Math.round(input.moraleRating))),
      input.seasonYear,
      input.notes,
      input.userId,
    ],
  );
}

export async function deletePulse(
  client: PoolClient,
  input: { orgId: string; pulseId: string },
): Promise<void> {
  await client.query(`DELETE FROM team_health_dashboard_pulses WHERE id = $1 AND org_id = $2`, [
    input.pulseId,
    input.orgId,
  ]);
}
