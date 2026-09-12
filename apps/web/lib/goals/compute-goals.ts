import type { PoolClient } from "@neondatabase/serverless";
import { evaluateGoal, summarizeGoals } from ".";
import type {
  GoalCategory,
  GoalEvaluation,
  GoalPriority,
  GoalsSummary,
  MetricType,
  SeasonGoal,
} from "./types";

export const GOAL_CATEGORIES: GoalCategory[] = ["competition", "technical", "outreach", "business", "team", "other"];
export const METRIC_TYPES: MetricType[] = ["percent", "count", "currency", "binary"];
export const GOAL_PRIORITIES: GoalPriority[] = ["low", "normal", "high"];

export type GoalsSetupStep = { id: string; label: string; detail: string; href: string };

export type GoalsView =
  | {
      status: "setup_required";
      message: string;
      steps: GoalsSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      evaluations: GoalEvaluation[];
      summary: GoalsSummary;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type GoalRow = {
  id: string;
  title: string;
  category: GoalCategory;
  metricType: MetricType;
  targetValue: string | number | null;
  currentValue: string | number | null;
  unit: string | null;
  dueOn: string | null;
  priority: GoalPriority;
  notes: string | null;
  seasonYear: number;
};

function num(value: string | number | null): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapGoal(row: GoalRow): SeasonGoal {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    metricType: row.metricType,
    targetValue: num(row.targetValue),
    currentValue: num(row.currentValue),
    unit: row.unit,
    dueOn: row.dueOn,
    priority: row.priority,
    notes: row.notes,
    seasonYear: row.seasonYear,
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

export async function computeGoalsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<GoalsView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to set and track season goals.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [goalResult, seasonResult] = await Promise.all([
    client.query<GoalRow>(
      `SELECT id, title, category, metric_type AS "metricType",
              target_value AS "targetValue", current_value AS "currentValue",
              unit, due_on::text AS "dueOn", priority, notes, season_year AS "seasonYear"
       FROM season_goals
       WHERE org_id = $1 AND season_year = $2
       ORDER BY
         CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
         created_at`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM season_goals WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const goals = goalResult.rows.map(mapGoal);
  const evaluations = goals.map((goal) => evaluateGoal(goal));
  const summary = summarizeGoals(goals);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    evaluations,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createGoal(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    title: string;
    category: GoalCategory;
    metricType: MetricType;
    targetValue: number;
    currentValue: number;
    unit: string | null;
    dueOn: string | null;
    priority: GoalPriority;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO season_goals
       (org_id, season_year, title, category, metric_type, target_value, current_value, unit, due_on, priority, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8,$9::date,$10,$11,$12)`,
    [
      input.orgId,
      input.seasonYear,
      input.title,
      input.category,
      input.metricType,
      Math.max(0, input.targetValue),
      Math.max(0, input.currentValue),
      input.unit,
      input.dueOn,
      input.priority,
      input.notes,
      input.userId,
    ],
  );
}

export async function updateGoal(
  client: PoolClient,
  input: {
    orgId: string;
    goalId: string;
    title?: string;
    category?: GoalCategory;
    metricType?: MetricType;
    targetValue?: number;
    currentValue?: number;
    unit?: string | null;
    dueOn?: string | null;
    priority?: GoalPriority;
    notes?: string | null;
  },
): Promise<void> {
  await client.query(
    `UPDATE season_goals SET
       title = COALESCE($3, title),
       category = COALESCE($4, category),
       metric_type = COALESCE($5, metric_type),
       target_value = COALESCE($6::numeric, target_value),
       current_value = COALESCE($7::numeric, current_value),
       unit = CASE WHEN $8::boolean THEN $9 ELSE unit END,
       due_on = CASE WHEN $10::boolean THEN $11::date ELSE due_on END,
       priority = COALESCE($12, priority),
       notes = CASE WHEN $13::boolean THEN $14 ELSE notes END,
       updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [
      input.goalId,
      input.orgId,
      input.title ?? null,
      input.category ?? null,
      input.metricType ?? null,
      input.targetValue ?? null,
      input.currentValue ?? null,
      input.unit !== undefined,
      input.unit ?? null,
      input.dueOn !== undefined,
      input.dueOn ?? null,
      input.priority ?? null,
      input.notes !== undefined,
      input.notes ?? null,
    ],
  );
}

export async function deleteGoal(
  client: PoolClient,
  input: { orgId: string; goalId: string },
): Promise<void> {
  await client.query(`DELETE FROM season_goals WHERE id = $1 AND org_id = $2`, [input.goalId, input.orgId]);
}
