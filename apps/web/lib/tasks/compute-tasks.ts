import { emitPreferredNotification } from "@vantage/core";
import type { PoolClient } from "@neondatabase/serverless";
import { buildBoard, buildMemberWorkload, summarizeMeetingOutput, visibleBenchmarkMedian } from ".";
import { resolveOwnerNames, workItemHref } from "../work-items/canonical";
import { loadRoster } from "../work-items/service";
import type { BuildTask, MemberWorkload, MeetingOutput, TaskBoard, TaskPriority, TaskStatus } from "./types";

// Client components take these from ./task-constants directly: this module
// imports @vantage/core, which reaches the Node pg driver and cannot be bundled
// for the browser. Re-exported so server callers keep one import.
export { SUBSYSTEM_SUGGESTIONS, TASK_PRIORITIES, TASK_STATUSES } from "./task-constants";

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
      canManage: boolean;
      meetingOutput: MeetingOutput;
      benchmark: {
        optedIn: boolean;
        medianWeeklyHours: number | null;
        teamCount: number;
      };
      memberWorkload: MemberWorkload[];
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
  assignees: string[] | null;
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
    assignees: row.assignees?.length ? row.assignees : row.assignee ? [row.assignee] : [],
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
): Promise<{ orgId: string; teamNumber: number | null; role: string } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null; role: string }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber",m.role::text AS role
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

  const [taskResult, seasonResult, memberResult, outputResult, benchmarkResult] = await Promise.all([
    client.query<TaskRow>(
      `SELECT t.id,t.title,t.subsystem,t.status,t.priority,t.assignee,
              COALESCE(array_agg(a.assignee ORDER BY a.created_at) FILTER(WHERE a.assignee IS NOT NULL),'{}') AS assignees,
              t.estimate_hours AS "estimateHours",t.due_on::text AS "dueOn",
              t.blocked_reason AS "blockedReason",t.notes,t.done_at::text AS "doneAt",
              t.season_year AS "seasonYear",t.created_at::text AS "createdAt"
       FROM build_tasks t LEFT JOIN build_task_assignees a ON a.task_id=t.id AND a.org_id=t.org_id
       WHERE t.org_id=$1 AND t.season_year=$2 GROUP BY t.id ORDER BY t.created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM build_tasks WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
    client.query<{ userId: string; name: string }>(
      `SELECT m.user_id::text AS "userId",COALESCE(NULLIF(trim(u.name),''),u.email) AS name
       FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 ORDER BY name`, [org.orgId]),
    client.query<{ weekStart: string; loggedHours: number; tasksCompleted: number }>(
      `WITH b AS(SELECT date_trunc('week',now()) w),
       h AS(SELECT COALESCE(sum(extract(epoch FROM(COALESCE(clock_out,now())-clock_in))/3600),0)::float8 v FROM hour_logs,b WHERE org_id=$1 AND kind IN('build','meeting') AND clock_in>=b.w),
       d AS(SELECT count(*)::int v FROM build_tasks,b WHERE org_id=$1 AND season_year=$2 AND done_at>=b.w)
       SELECT b.w::date::text AS "weekStart",h.v AS "loggedHours",d.v AS "tasksCompleted" FROM b,h,d`, [org.orgId,seasonYear]),
    client.query<{ optedIn: boolean; teamCount: number; medianWeeklyHours: string | number | null }>(
      `SELECT opted_in AS "optedIn",team_count AS "teamCount",median_weekly_hours AS "medianWeeklyHours" FROM get_ops_norms_benchmark($1)`, [org.orgId]),
  ]);

  const tasks = taskResult.rows.map(mapTask);
  const board = buildBoard(tasks);
  const subsystems = [...new Set(tasks.map((t) => t.subsystem).filter(Boolean))].sort();
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  const output = outputResult.rows[0] ?? { weekStart: new Date().toISOString().slice(0,10), loggedHours: 0, tasksCompleted: 0 };
  const benchmark = benchmarkResult.rows[0] ?? { optedIn: false, teamCount: 0, medianWeeklyHours: null };
  const teamCount = Number(benchmark.teamCount);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    board,
    subsystems,
    computedAt: new Date().toISOString(),
    canManage: ["owner","admin"].includes(org.role),
    meetingOutput: summarizeMeetingOutput({ weekStart: output.weekStart, loggedHours: Number(output.loggedHours), tasksCompleted: Number(output.tasksCompleted) }),
    benchmark: {
      optedIn: Boolean(benchmark.optedIn),
      medianWeeklyHours: visibleBenchmarkMedian({ optedIn: Boolean(benchmark.optedIn), teamCount, median: benchmark.medianWeeklyHours == null ? null : Number(benchmark.medianWeeklyHours) }),
      teamCount,
    },
    memberWorkload: buildMemberWorkload(memberResult.rows,tasks),
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
    assignees?: string[];
    estimateHours: number | null;
    dueOn: string | null;
    seasonYear: number;
  },
): Promise<void> {
  const created = await client.query<{id:string}>(
    `INSERT INTO build_tasks (org_id, title, subsystem, status, priority, assignee, estimate_hours, due_on, season_year, created_by)
     VALUES ($1,$2,$3,'todo',$4,$5,$6::numeric,$7::date,$8,$9) RETURNING id`,
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
  await replaceTaskAssignees(client,{orgId:input.orgId,taskId:created.rows[0]!.id,userId:input.userId,assignees:input.assignees?.length?input.assignees:input.assignee?[input.assignee]:[]});
}

/**
 * Replace a task's owners.
 *
 * `build_tasks.assignee` / `build_task_assignees.assignee` are free text (students are not always
 * platform users), which is how one person ended up on a board three times as "sam r",
 * "Sam R." and "Sam Rodriguez". Names are canonicalized against the roster before they are stored —
 * an exact single match is rewritten to the member's own spelling, anything less confident is
 * stored exactly as typed — and the members we did resolve get the same assignment notification a
 * todo assignee gets, so the two trackers behave the same way.
 */
export async function replaceTaskAssignees(client:PoolClient,input:{orgId:string;taskId:string;userId:string;assignees:string[]}) {
  const roster = await loadRoster(client, input.orgId).catch(() => []);
  const owners = resolveOwnerNames(
    input.assignees.map((name) => name.trim().slice(0, 120)).filter(Boolean),
    roster,
  ).slice(0, 12);
  const names = owners.map((owner) => owner.name);

  const previous = await client
    .query<{ assignee: string }>(
      `SELECT assignee FROM build_task_assignees WHERE task_id=$1 AND org_id=$2`,
      [input.taskId, input.orgId],
    )
    .catch(() => ({ rows: [] as { assignee: string }[] }));
  const previousIds = new Set(
    resolveOwnerNames(previous.rows.map((row) => row.assignee), roster)
      .map((owner) => owner.userId)
      .filter((id): id is string => Boolean(id)),
  );

  await client.query(`DELETE FROM build_task_assignees WHERE task_id=$1 AND org_id=$2`,[input.taskId,input.orgId]);
  for(const name of names) await client.query(`INSERT INTO build_task_assignees(task_id,org_id,assignee,added_by) VALUES($1,$2,$3,$4)`,[input.taskId,input.orgId,name,input.userId]);
  await client.query(`UPDATE build_tasks SET assignee=$3,updated_at=now() WHERE id=$1 AND org_id=$2`,[input.taskId,input.orgId,names[0]??null]);

  const task = await client.query<{ title: string }>(
    `SELECT title FROM build_tasks WHERE id=$1 AND org_id=$2`,
    [input.taskId, input.orgId],
  );
  const title = task.rows[0]?.title;
  if (!title) return;
  const actor = await client.query<{ name: string }>(`SELECT name FROM users WHERE id=$1`, [input.userId]);
  const actorName = actor.rows[0]?.name ?? "A teammate";

  for (const owner of owners) {
    if (!owner.userId || owner.userId === input.userId || previousIds.has(owner.userId)) continue;
    await emitPreferredNotification(client, {
      userId: owner.userId,
      orgId: input.orgId,
      type: "todo_assigned",
      payload: {
        title: "Build task assigned to you",
        body: `${actorName} assigned “${title}”.`,
        taskId: input.taskId,
        href: workItemHref("build_task", input.orgId, input.taskId),
      },
    });
  }
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
  // Single-owner edits go through the same canonicalization as the multi-assignee path, or the
  // two write different spellings of the same person onto the same row.
  let assignee = input.assignee;
  if (assignee) {
    const roster = await loadRoster(client, input.orgId).catch(() => []);
    assignee = resolveOwnerNames([assignee], roster)[0]?.name ?? assignee;
  }
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
      assignee ?? null,
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
