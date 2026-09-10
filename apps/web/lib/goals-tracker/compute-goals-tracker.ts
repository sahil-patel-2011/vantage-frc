import type { PoolClient } from "@neondatabase/serverless";
import { computeGoalProgress, summarizeGoals } from ".";
import type { Goal, GoalCategory, GoalCheckin, GoalProgress, GoalStatus, GoalsSummary } from "./types";

export type GoalSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type GoalsTrackerView =
  | {
      status: "setup_required";
      message: string;
      steps: GoalSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      goals: GoalProgress[];
      summary: GoalsSummary;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type GoalRow = {
  id: string;
  title: string;
  description: string | null;
  category: GoalCategory;
  metricUnit: string;
  startValue: string;
  targetValue: string;
  status: GoalStatus;
  dueOn: string | null;
  seasonYear: number;
  createdAt: string;
};

type CheckinRow = {
  id: string;
  goalId: string;
  value: string;
  note: string | null;
  occurredOn: string;
  createdAt: string;
};

function mapGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    metricUnit: row.metricUnit,
    startValue: Number(row.startValue) || 0,
    targetValue: Number(row.targetValue) || 0,
    status: row.status,
    dueOn: row.dueOn,
    seasonYear: row.seasonYear,
    createdAt: row.createdAt,
  };
}

function mapCheckin(row: CheckinRow): GoalCheckin {
  return {
    id: row.id,
    goalId: row.goalId,
    value: Number(row.value) || 0,
    note: row.note,
    occurredOn: row.occurredOn,
    createdAt: row.createdAt,
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

export async function computeGoalsTrackerView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<GoalsTrackerView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to set season goals and track progress.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [goalResult, seasonResult] = await Promise.all([
    client.query<GoalRow>(
      `SELECT id, title, description, category, metric_unit AS "metricUnit",
              start_value::text AS "startValue", target_value::text AS "targetValue",
              status, due_on::text AS "dueOn", season_year AS "seasonYear", created_at::text AS "createdAt"
       FROM goals_tracker_goals
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM goals_tracker_goals WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const goals = goalResult.rows.map(mapGoal);
  const goalIds = goals.map((g) => g.id);

  const checkinsByGoal = new Map<string, GoalCheckin[]>();
  if (goalIds.length > 0) {
    const checkinResult = await client.query<CheckinRow>(
      `SELECT id, goal_id AS "goalId", value::text AS value, note, occurred_on::text AS "occurredOn",
              created_at::text AS "createdAt"
       FROM goals_tracker_checkins
       WHERE org_id = $1 AND goal_id = ANY($2::uuid[])
       ORDER BY occurred_on DESC, created_at DESC`,
      [org.orgId, goalIds],
    );
    for (const row of checkinResult.rows) {
      const checkin = mapCheckin(row);
      const list = checkinsByGoal.get(checkin.goalId) ?? [];
      list.push(checkin);
      checkinsByGoal.set(checkin.goalId, list);
    }
  }

  const progressRows = goals.map((goal) => computeGoalProgress(goal, checkinsByGoal.get(goal.id) ?? []));
  const summary = summarizeGoals(progressRows);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    goals: progressRows,
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
    title: string;
    description: string | null;
    category: GoalCategory;
    metricUnit: string;
    startValue: number;
    targetValue: number;
    dueOn: string | null;
    seasonYear: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO goals_tracker_goals (
       org_id, title, description, category, metric_unit, start_value, target_value,
       due_on, season_year, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10)`,
    [
      input.orgId,
      input.title,
      input.description,
      input.category,
      input.metricUnit,
      input.startValue,
      input.targetValue,
      input.dueOn,
      input.seasonYear,
      input.userId,
    ],
  );
}

export async function logCheckin(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    goalId: string;
    value: number;
    note: string | null;
    occurredOn: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO goals_tracker_checkins (org_id, goal_id, value, note, occurred_on, checked_in_by)
     VALUES ($1,$2,$3,$4,$5::date,$6)`,
    [input.orgId, input.goalId, input.value, input.note, input.occurredOn, input.userId],
  );
}

export async function updateGoalStatus(
  client: PoolClient,
  input: { orgId: string; goalId: string; status: GoalStatus },
): Promise<void> {
  await client.query(`UPDATE goals_tracker_goals SET status = $1 WHERE id = $2 AND org_id = $3`, [
    input.status,
    input.goalId,
    input.orgId,
  ]);
}

export async function deleteGoal(client: PoolClient, input: { orgId: string; goalId: string }): Promise<void> {
  await client.query(`DELETE FROM goals_tracker_goals WHERE id = $1 AND org_id = $2`, [
    input.goalId,
    input.orgId,
  ]);
}
