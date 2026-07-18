import type { PoolClient } from "@neondatabase/serverless";
import { computeBurndownSeries, currentSeasonYear, summarizeBurndown } from ".";
import { buildBurndownSetupSteps, type BuildBurndownSetupStep } from "./build-burndown-related";
import type {
  BuildBurndownPlan,
  BuildBurndownSummary,
  BuildBurndownTask,
  BuildTaskCategory,
  BuildTaskStatus,
  BurndownPoint,
} from "./types";

export type { BuildBurndownSetupStep };

export type BuildBurndownView =
  | {
      status: "setup_required";
      message: string;
      steps: BuildBurndownSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      plan: BuildBurndownPlan | null;
      tasks: BuildBurndownTask[];
      series: BurndownPoint[];
      summary: BuildBurndownSummary;
      computedAt: string;
    };

type TaskRow = {
  id: string;
  title: string;
  category: BuildTaskCategory;
  status: BuildTaskStatus;
  plannedDate: string;
  completedOn: string | null;
  seasonYear: number;
  notes: string | null;
  createdAt: string;
};

function mapTask(row: TaskRow): BuildBurndownTask {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    status: row.status,
    plannedDate: row.plannedDate,
    completedOn: row.completedOn,
    seasonYear: row.seasonYear,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

type PlanRow = {
  id: string;
  seasonYear: number;
  kickoffDate: string;
  competitionDate: string;
};

function mapPlan(row: PlanRow): BuildBurndownPlan {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    kickoffDate: row.kickoffDate,
    competitionDate: row.competitionDate,
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

export async function computeBuildBurndownView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<BuildBurndownView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to track the build-season burndown.",
      steps: buildBurndownSetupSteps(null),
      orgId: null,
      seasonYear,
    };
  }

  const [taskResult, planResult, seasonResult] = await Promise.all([
    client.query<TaskRow>(
      `SELECT id, title, category, status, planned_date::text AS "plannedDate",
              completed_on::text AS "completedOn", season_year AS "seasonYear", notes,
              created_at::text AS "createdAt"
       FROM build_burndown_tasks
       WHERE org_id = $1 AND season_year = $2
       ORDER BY planned_date ASC, created_at ASC`,
      [org.orgId, seasonYear],
    ),
    client.query<PlanRow>(
      `SELECT id, season_year AS "seasonYear", kickoff_date::text AS "kickoffDate",
              competition_date::text AS "competitionDate"
       FROM build_burndown_plans
       WHERE org_id = $1 AND season_year = $2
       LIMIT 1`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM build_burndown_tasks WHERE org_id = $1
       UNION
       SELECT DISTINCT season_year AS "seasonYear" FROM build_burndown_plans WHERE org_id = $1
       ORDER BY "seasonYear" DESC`,
      [org.orgId],
    ),
  ]);

  const tasks = taskResult.rows.map(mapTask);
  const plan = planResult.rows[0] ? mapPlan(planResult.rows[0]) : null;
  const series = plan ? computeBurndownSeries(tasks, plan) : [];
  const summary = summarizeBurndown(tasks, plan);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    plan,
    tasks,
    series,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function setPlan(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number; kickoffDate: string; competitionDate: string },
): Promise<void> {
  await client.query(
    `INSERT INTO build_burndown_plans (org_id, season_year, kickoff_date, competition_date, created_by)
     VALUES ($1,$2,$3::date,$4::date,$5)
     ON CONFLICT (org_id, season_year)
     DO UPDATE SET kickoff_date = EXCLUDED.kickoff_date, competition_date = EXCLUDED.competition_date`,
    [input.orgId, input.seasonYear, input.kickoffDate, input.competitionDate, input.userId],
  );
}

export async function createTask(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    title: string;
    category: BuildTaskCategory;
    plannedDate: string;
    seasonYear: number;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO build_burndown_tasks (org_id, title, category, planned_date, season_year, notes, created_by)
     VALUES ($1,$2,$3,$4::date,$5,$6,$7)`,
    [input.orgId, input.title, input.category, input.plannedDate, input.seasonYear, input.notes, input.userId],
  );
}

export async function updateTaskStatus(
  client: PoolClient,
  input: { orgId: string; taskId: string; status: BuildTaskStatus },
): Promise<void> {
  const completedOn = input.status === "done" ? new Date().toISOString().slice(0, 10) : null;
  await client.query(
    `UPDATE build_burndown_tasks
     SET status = $1, completed_on = $2::date
     WHERE id = $3 AND org_id = $4`,
    [input.status, completedOn, input.taskId, input.orgId],
  );
}

export async function deleteTask(
  client: PoolClient,
  input: { orgId: string; taskId: string },
): Promise<void> {
  await client.query(`DELETE FROM build_burndown_tasks WHERE id = $1 AND org_id = $2`, [
    input.taskId,
    input.orgId,
  ]);
}
