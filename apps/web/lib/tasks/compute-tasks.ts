import type { PoolClient } from "@neondatabase/serverless";
import { buildBoard } from ".";
import type { BuildTask, TaskBoard, TaskPriority, TaskStatus } from "./types";

export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "done", "archived"];
export const TASK_PRIORITIES: TaskPriority[] = ["low", "normal", "high", "critical"];
export const SUBSYSTEM_SUGGESTIONS = [
  "drivetrain",
  "intake",
  "shooter",
  "elevator",
  "arm",
  "climber",
  "electrical",
  "pneumatics",
  "controls",
  "software",
  "vision",
  "fabrication",
  "general",
];

export type TasksSetupStep = { id: string; label: string; detail: string; href: string };

export type TasksView =
  | {
      status: "setup_required";
      message: string;
      steps: TasksSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      board: TaskBoard;
      subsystems: string[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type TaskRow = {
  id: string;
  title: string;
  subsystem: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: string | null;
  estimateHours: string | number | null;
  dueOn: string | null;
  blockedReason: string | null;
  notes: string | null;
  doneAt: string | null;
  seasonYear: number;
  createdAt: string;
};

function mapTask(row: TaskRow): BuildTask {
  const estimate = row.estimateHours == null ? null : Number(row.estimateHours);
  return {
    id: row.id,
    title: row.title,
    subsystem: row.subsystem,
    status: row.status,
    priority: row.priority,
    assignee: row.assignee,
    estimateHours: estimate != null && Number.isFinite(estimate) ? estimate : null,
    dueOn: row.dueOn,
    blockedReason: row.blockedReason,
    notes: row.notes,
    doneAt: row.doneAt,
    seasonYear: row.seasonYear,
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

export async function computeTasksView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<TasksView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to plan and track build-season tasks.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [taskResult, seasonResult] = await Promise.all([
    client.query<TaskRow>(
      `SELECT id, title, subsystem, status, priority, assignee,
              estimate_hours AS "estimateHours", due_on::text AS "dueOn",
              blocked_reason AS "blockedReason", notes, done_at::text AS "doneAt",
              season_year AS "seasonYear", created_at::text AS "createdAt"
       FROM build_tasks
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM build_tasks WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const tasks = taskResult.rows.map(mapTask);
  const board = buildBoard(tasks);
  const subsystems = [...new Set(tasks.map((t) => t.subsystem).filter(Boolean))].sort();
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    board,
    subsystems,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createTask(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    title: string;
    subsystem: string;
    priority: TaskPriority;
    assignee: string | null;
    estimateHours: number | null;
    dueOn: string | null;
    seasonYear: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO build_tasks (org_id, title, subsystem, status, priority, assignee, estimate_hours, due_on, season_year, created_by)
     VALUES ($1,$2,$3,'todo',$4,$5,$6::numeric,$7::date,$8,$9)`,
    [
      input.orgId,
      input.title,
      input.subsystem || "general",
      input.priority,
      input.assignee,
      input.estimateHours,
      input.dueOn,
      input.seasonYear,
      input.userId,
    ],
  );
}

export async function setTaskStatus(
  client: PoolClient,
  input: { orgId: string; taskId: string; status: TaskStatus; blockedReason?: string | null },
): Promise<void> {
  await client.query(
    `UPDATE build_tasks SET
       status = $3,
       blocked_reason = CASE WHEN $3 = 'blocked' THEN $4 ELSE NULL END,
       done_at = CASE WHEN $3 = 'done' THEN COALESCE(done_at, now()) ELSE NULL END,
       updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [input.taskId, input.orgId, input.status, input.blockedReason ?? null],
  );
}

export async function updateTaskFields(
  client: PoolClient,
  input: {
    orgId: string;
    taskId: string;
    title?: string;
    subsystem?: string;
    priority?: TaskPriority;
    assignee?: string | null;
    estimateHours?: number | null;
    dueOn?: string | null;
  },
): Promise<void> {
  await client.query(
    `UPDATE build_tasks SET
       title = COALESCE($3, title),
       subsystem = COALESCE($4, subsystem),
       priority = COALESCE($5, priority),
       assignee = CASE WHEN $6::boolean THEN $7 ELSE assignee END,
       estimate_hours = CASE WHEN $8::boolean THEN $9::numeric ELSE estimate_hours END,
       due_on = CASE WHEN $10::boolean THEN $11::date ELSE due_on END,
       updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [
      input.taskId,
      input.orgId,
      input.title ?? null,
      input.subsystem ?? null,
      input.priority ?? null,
      input.assignee !== undefined,
      input.assignee ?? null,
      input.estimateHours !== undefined,
      input.estimateHours ?? null,
      input.dueOn !== undefined,
      input.dueOn ?? null,
    ],
  );
}

export async function deleteTask(
  client: PoolClient,
  input: { orgId: string; taskId: string },
): Promise<void> {
  await client.query(`DELETE FROM build_tasks WHERE id = $1 AND org_id = $2`, [input.taskId, input.orgId]);
}
