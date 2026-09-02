// The one task store. build_tasks (0044 + 0502) is canonical for team work:
// the build-season board (/api/tasks) and the Soft-UI todo list (/api/todos)
// both read and write through here so a task added on either page shows on
// both. All queries run on the RLS-scoped client from the caller's withRls.
//
// Assignment has two representations that are kept in sync:
//   * assignee_user_id — a real member (what the todo list sets);
//   * assignee / build_task_assignees — free-text names (what the board sets,
//     because students may not all be platform users yet).
// Setting a member writes their name into the text fields; setting names
// links the member when exactly one roster entry matches the first name.

import type { PoolClient } from "@neondatabase/serverless";
import type { TaskPriority, TaskStatus } from "./types";

export const STORE_TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "done", "archived"];
export const STORE_TASK_PRIORITIES: TaskPriority[] = ["low", "normal", "high", "critical"];

export type StoredTask = {
  id: string;
  title: string;
  subsystem: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** First display name (board compatibility). */
  assignee: string | null;
  assignees: string[];
  assigneeUserId: string | null;
  assigneeName: string | null;
  subteamId: string | null;
  subteamName: string | null;
  subteamColor: string | null;
  estimateHours: number | null;
  dueOn: string | null;
  blockedReason: string | null;
  notes: string | null;
  doneAt: string | null;
  completedBy: string | null;
  seasonYear: number;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  legacySource: string | null;
  legacyId: string | null;
};

type TaskRow = Omit<StoredTask, "estimateHours" | "assignees"> & {
  estimateHours: string | number | null;
  assignees: string[] | null;
};

function mapRow(row: TaskRow): StoredTask {
  const estimate = row.estimateHours == null ? null : Number(row.estimateHours);
  const names = row.assignees?.length ? row.assignees : row.assignee ? [row.assignee] : [];
  return {
    ...row,
    assignees: names,
    estimateHours: estimate != null && Number.isFinite(estimate) ? estimate : null,
    seasonYear: Number(row.seasonYear),
  };
}

const TASK_SELECT = `
  SELECT t.id, t.title, t.subsystem, t.status, t.priority, t.assignee,
         COALESCE(array_agg(a.assignee ORDER BY a.created_at) FILTER (WHERE a.assignee IS NOT NULL), '{}') AS assignees,
         t.assignee_user_id AS "assigneeUserId",
         COALESCE(NULLIF(btrim(au.name), ''), au.email) AS "assigneeName",
         t.subteam_id AS "subteamId", s.name AS "subteamName", s.color AS "subteamColor",
         t.estimate_hours AS "estimateHours", t.due_on::text AS "dueOn",
         t.blocked_reason AS "blockedReason", t.notes,
         t.done_at::text AS "doneAt", t.completed_by AS "completedBy", t.season_year AS "seasonYear",
         t.created_by AS "createdBy", cu.name AS "createdByName",
         t.created_at::text AS "createdAt", t.updated_at::text AS "updatedAt",
         t.legacy_source AS "legacySource", t.legacy_id AS "legacyId"
  FROM build_tasks t
  LEFT JOIN build_task_assignees a ON a.task_id = t.id AND a.org_id = t.org_id
  LEFT JOIN users au ON au.id = t.assignee_user_id
  LEFT JOIN users cu ON cu.id = t.created_by
  LEFT JOIN team_subteams s ON s.id = t.subteam_id AND s.org_id = t.org_id`;

const TASK_GROUP = `GROUP BY t.id, au.name, au.email, cu.name, s.name, s.color`;

export async function listTasks(
  client: PoolClient,
  input: { orgId: string; seasonYear?: number | null; includeArchived?: boolean },
): Promise<StoredTask[]> {
  const result = await client.query<TaskRow>(
    `${TASK_SELECT}
     WHERE t.org_id = $1::uuid
       AND ($2::integer IS NULL OR t.season_year = $2::integer)
       AND ($3::boolean OR t.status <> 'archived')
     ${TASK_GROUP}
     ORDER BY t.created_at DESC`,
    [input.orgId, input.seasonYear ?? null, input.includeArchived !== false],
  );
  return result.rows.map(mapRow);
}

export async function getTask(client: PoolClient, input: { orgId: string; taskId: string }): Promise<StoredTask | null> {
  const result = await client.query<TaskRow>(
    `${TASK_SELECT} WHERE t.org_id = $1::uuid AND t.id = $2::uuid ${TASK_GROUP}`,
    [input.orgId, input.taskId],
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function listTaskSeasons(client: PoolClient, orgId: string): Promise<number[]> {
  const result = await client.query<{ seasonYear: number }>(
    `SELECT DISTINCT season_year AS "seasonYear" FROM build_tasks WHERE org_id = $1::uuid ORDER BY season_year DESC`,
    [orgId],
  );
  return result.rows.map((row) => Number(row.seasonYear));
}

// ---- roster helpers ----

async function memberName(client: PoolClient, orgId: string, userId: string): Promise<string> {
  const row = await client.query<{ name: string }>(
    `SELECT COALESCE(NULLIF(btrim(u.name), ''), u.email) AS name
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1::uuid AND m.user_id = $2::uuid`,
    [orgId, userId],
  );
  const name = row.rows[0]?.name;
  if (!name) throw new Error("Assignee must be an organization member");
  return name;
}

/** The single member whose display name equals `name`, or null when none/ambiguous. */
async function memberByName(client: PoolClient, orgId: string, name: string): Promise<string | null> {
  const row = await client.query<{ userId: string }>(
    `SELECT m.user_id::text AS "userId"
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1::uuid AND lower(btrim(u.name)) = lower(btrim($2::text))
     LIMIT 2`,
    [orgId, name],
  );
  return row.rows.length === 1 ? row.rows[0]!.userId : null;
}

async function assertSubteam(client: PoolClient, orgId: string, subteamId: string | null): Promise<void> {
  if (!subteamId) return;
  const row = await client.query(`SELECT 1 FROM team_subteams WHERE org_id = $1::uuid AND id = $2::uuid`, [
    orgId,
    subteamId,
  ]);
  if (!row.rowCount) throw new Error("Unknown subteam");
}

export function normalizeAssigneeNames(names: string[]): string[] {
  return [...new Set(names.map((name) => name.trim().slice(0, 120)).filter(Boolean))].slice(0, 12);
}

async function writeAssigneeNames(
  client: PoolClient,
  input: { orgId: string; taskId: string; userId: string; names: string[] },
): Promise<void> {
  await client.query(`DELETE FROM build_task_assignees WHERE task_id = $1::uuid AND org_id = $2::uuid`, [
    input.taskId,
    input.orgId,
  ]);
  for (const name of input.names) {
    await client.query(
      `INSERT INTO build_task_assignees (task_id, org_id, assignee, added_by) VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
       ON CONFLICT DO NOTHING`,
      [input.taskId, input.orgId, name, input.userId],
    );
  }
}

/** Assign by member account: text fields follow the member's name. */
export async function assignTaskToMember(
  client: PoolClient,
  input: { orgId: string; taskId: string; userId: string; assigneeUserId: string | null },
): Promise<void> {
  if (!input.assigneeUserId) {
    await writeAssigneeNames(client, { ...input, names: [] });
    await client.query(
      `UPDATE build_tasks SET assignee_user_id = NULL, assignee = NULL, updated_at = now()
       WHERE id = $1::uuid AND org_id = $2::uuid`,
      [input.taskId, input.orgId],
    );
    return;
  }
  const name = await memberName(client, input.orgId, input.assigneeUserId);
  await writeAssigneeNames(client, { ...input, names: [name] });
  await client.query(
    `UPDATE build_tasks SET assignee_user_id = $3::uuid, assignee = $4, updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.taskId, input.orgId, input.assigneeUserId, name],
  );
}

/** Assign by names (board style): the member link follows the first name when unambiguous. */
export async function replaceTaskAssignees(
  client: PoolClient,
  input: { orgId: string; taskId: string; userId: string; assignees: string[] },
): Promise<void> {
  const names = normalizeAssigneeNames(input.assignees);
  await writeAssigneeNames(client, { ...input, names });
  const first = names[0] ?? null;
  const linked = first ? await memberByName(client, input.orgId, first) : null;
  await client.query(
    `UPDATE build_tasks SET assignee = $3, assignee_user_id = $4::uuid, updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.taskId, input.orgId, first, linked],
  );
}

// ---- writes ----

export type CreateTaskInput = {
  orgId: string;
  userId: string;
  title: string;
  seasonYear: number;
  subsystem?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  notes?: string | null;
  assignees?: string[];
  assigneeUserId?: string | null;
  subteamId?: string | null;
  estimateHours?: number | null;
  dueOn?: string | null;
};

export async function insertTask(client: PoolClient, input: CreateTaskInput): Promise<string> {
  await assertSubteam(client, input.orgId, input.subteamId ?? null);
  const status = input.status && STORE_TASK_STATUSES.includes(input.status) ? input.status : "todo";
  const created = await client.query<{ id: string }>(
    `INSERT INTO build_tasks
       (org_id, title, subsystem, status, priority, notes, estimate_hours, due_on, season_year, created_by,
        subteam_id, done_at, completed_by)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::numeric, $8::date, $9, $10::uuid, $11::uuid,
             CASE WHEN $4 = 'done' THEN now() ELSE NULL END,
             CASE WHEN $4 = 'done' THEN $10::uuid ELSE NULL END)
     RETURNING id`,
    [
      input.orgId,
      input.title,
      input.subsystem?.trim() || "general",
      status,
      input.priority && STORE_TASK_PRIORITIES.includes(input.priority) ? input.priority : "normal",
      input.notes?.trim() || null,
      input.estimateHours ?? null,
      input.dueOn ?? null,
      input.seasonYear,
      input.userId,
      input.subteamId ?? null,
    ],
  );
  const taskId = created.rows[0]!.id;
  if (input.assigneeUserId) {
    await assignTaskToMember(client, { orgId: input.orgId, taskId, userId: input.userId, assigneeUserId: input.assigneeUserId });
  } else if (input.assignees?.length) {
    await replaceTaskAssignees(client, { orgId: input.orgId, taskId, userId: input.userId, assignees: input.assignees });
  }
  return taskId;
}

export type TaskPatch = {
  title?: string;
  subsystem?: string;
  status?: TaskStatus;
  blockedReason?: string | null;
  priority?: TaskPriority;
  notes?: string | null;
  estimateHours?: number | null;
  dueOn?: string | null;
  subteamId?: string | null;
  /** Member assignment (todo list). undefined = untouched; null = unassign. */
  assigneeUserId?: string | null;
  /** Name assignment (board). Applied after assigneeUserId when both are sent. */
  assignees?: string[];
};

export async function updateTask(
  client: PoolClient,
  input: { orgId: string; taskId: string; userId: string; patch: TaskPatch },
): Promise<void> {
  const { patch } = input;
  if (patch.subteamId !== undefined) await assertSubteam(client, input.orgId, patch.subteamId);
  await client.query(
    `UPDATE build_tasks SET
       title = COALESCE($3, title),
       subsystem = COALESCE($4, subsystem),
       priority = COALESCE($5, priority),
       status = COALESCE($6, status),
       blocked_reason = CASE
         WHEN COALESCE($6, status) <> 'blocked' THEN NULL
         WHEN $7::boolean THEN $8
         ELSE blocked_reason
       END,
       done_at = CASE
         WHEN COALESCE($6, status) = 'done' THEN COALESCE(done_at, now())
         WHEN COALESCE($6, status) = 'archived' THEN done_at
         ELSE NULL
       END,
       completed_by = CASE
         WHEN COALESCE($6, status) = 'done' THEN COALESCE(completed_by, $15::uuid)
         WHEN COALESCE($6, status) = 'archived' THEN completed_by
         ELSE NULL
       END,
       notes = CASE WHEN $9::boolean THEN $10 ELSE notes END,
       estimate_hours = CASE WHEN $11::boolean THEN $12::numeric ELSE estimate_hours END,
       due_on = CASE WHEN $13::boolean THEN $14::date ELSE due_on END,
       subteam_id = CASE WHEN $16::boolean THEN $17::uuid ELSE subteam_id END,
       updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [
      input.taskId,
      input.orgId,
      patch.title ?? null,
      patch.subsystem?.trim() || null,
      patch.priority ?? null,
      patch.status ?? null,
      patch.blockedReason !== undefined,
      patch.blockedReason ?? null,
      patch.notes !== undefined,
      patch.notes?.trim() || null,
      patch.estimateHours !== undefined,
      patch.estimateHours ?? null,
      patch.dueOn !== undefined,
      patch.dueOn ?? null,
      input.userId,
      patch.subteamId !== undefined,
      patch.subteamId ?? null,
    ],
  );
  if (patch.assigneeUserId !== undefined) {
    await assignTaskToMember(client, { orgId: input.orgId, taskId: input.taskId, userId: input.userId, assigneeUserId: patch.assigneeUserId });
  }
  if (patch.assignees !== undefined) {
    await replaceTaskAssignees(client, { orgId: input.orgId, taskId: input.taskId, userId: input.userId, assignees: patch.assignees });
  }
}

export async function deleteTask(client: PoolClient, input: { orgId: string; taskId: string }): Promise<boolean> {
  const result = await client.query(`DELETE FROM build_tasks WHERE id = $1::uuid AND org_id = $2::uuid`, [
    input.taskId,
    input.orgId,
  ]);
  return Boolean(result.rowCount);
}

// ---- dashboard rollup (replaces the direct team_todos reads in lib/dashboard/snapshot.ts) ----

export type DashboardTaskSummary = {
  todo: number;
  doing: number;
  open: number;
  mineOpen: number;
  overdue: number;
  items: Array<{ id: string; title: string; status: "todo" | "doing"; dueOn: string | null; assigneeName: string | null }>;
};

export async function summarizeTasksForDashboard(
  client: PoolClient,
  input: { orgId: string; userId: string },
): Promise<DashboardTaskSummary> {
  const [counts, items] = await Promise.all([
    client.query<{ todo: string; doing: string; mineOpen: string; overdue: string }>(
      `SELECT
         count(*) FILTER (WHERE status = 'todo')::text AS todo,
         count(*) FILTER (WHERE status IN ('in_progress', 'blocked'))::text AS doing,
         count(*) FILTER (
           WHERE status NOT IN ('done', 'archived') AND assignee_user_id = $2::uuid
         )::text AS "mineOpen",
         count(*) FILTER (
           WHERE status NOT IN ('done', 'archived') AND due_on IS NOT NULL AND due_on < CURRENT_DATE
         )::text AS overdue
       FROM build_tasks
       WHERE org_id = $1::uuid`,
      [input.orgId, input.userId],
    ),
    client.query<{ id: string; title: string; status: "todo" | "doing"; dueOn: string | null; assigneeName: string | null }>(
      `SELECT t.id, t.title,
              CASE WHEN t.status = 'todo' THEN 'todo' ELSE 'doing' END AS status,
              t.due_on::text AS "dueOn",
              COALESCE(NULLIF(btrim(u.name), ''), t.assignee) AS "assigneeName"
       FROM build_tasks t
       LEFT JOIN users u ON u.id = t.assignee_user_id
       WHERE t.org_id = $1::uuid AND t.status NOT IN ('done', 'archived')
       ORDER BY
         CASE WHEN t.assignee_user_id = $2::uuid THEN 0 ELSE 1 END,
         CASE t.status WHEN 'in_progress' THEN 0 WHEN 'blocked' THEN 1 ELSE 2 END,
         t.due_on NULLS LAST,
         t.created_at DESC
       LIMIT 5`,
      [input.orgId, input.userId],
    ),
  ]);
  const todo = Number(counts.rows[0]?.todo ?? 0);
  const doing = Number(counts.rows[0]?.doing ?? 0);
  return {
    todo,
    doing,
    open: todo + doing,
    mineOpen: Number(counts.rows[0]?.mineOpen ?? 0),
    overdue: Number(counts.rows[0]?.overdue ?? 0),
    items: items.rows,
  };
}
