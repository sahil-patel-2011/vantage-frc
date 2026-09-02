import type { PoolClient } from "@neondatabase/serverless";
import { buildBoard, buildMemberWorkload, summarizeMeetingOutput, visibleBenchmarkMedian } from ".";
import {
  deleteTask as deleteStoredTask,
  insertTask,
  listTaskSeasons,
  listTasks,
  replaceTaskAssignees as storeReplaceAssignees,
  updateTask as updateStoredTask,
  type StoredTask,
} from "./store";
import type { BuildTask, MemberWorkload, MeetingOutput, TaskBoard, TaskPriority, TaskStatus } from "./types";

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

/** Board shape over a merged-store row (lib/tasks/store). */
export function mapStoredTask(task: StoredTask): BuildTask {
  return {
    id: task.id,
    title: task.title,
    subsystem: task.subsystem,
    status: task.status,
    priority: task.priority,
    assignee: task.assignee ?? (task.assigneeUserId ? task.assigneeName : null),
    assignees: task.assignees.length ? task.assignees : task.assigneeName ? [task.assigneeName] : [],
    estimateHours: task.estimateHours,
    dueOn: task.dueOn,
    blockedReason: task.blockedReason,
    notes: task.notes,
    doneAt: task.doneAt,
    seasonYear: task.seasonYear,
    createdAt: task.createdAt,
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

  const [stored, seasonList, memberResult, outputResult, benchmarkResult] = await Promise.all([
    listTasks(client, { orgId: org.orgId, seasonYear, includeArchived: true }),
    listTaskSeasons(client, org.orgId),
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

  const tasks = stored.map(mapStoredTask);
  const board = buildBoard(tasks);
  const subsystems = [...new Set(tasks.map((t) => t.subsystem).filter(Boolean))].sort();
  const seasons = [...seasonList];
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

// ---- write helpers (run inside the caller's withRls transaction; all via lib/tasks/store) ----

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
  await insertTask(client, {
    orgId: input.orgId,
    userId: input.userId,
    title: input.title,
    seasonYear: input.seasonYear,
    subsystem: input.subsystem || "general",
    status: "todo",
    priority: input.priority,
    assignees: input.assignees?.length ? input.assignees : input.assignee ? [input.assignee] : [],
    estimateHours: input.estimateHours,
    dueOn: input.dueOn,
  });
}

export async function replaceTaskAssignees(
  client: PoolClient,
  input: { orgId: string; taskId: string; userId: string; assignees: string[] },
) {
  await storeReplaceAssignees(client, input);
}

export async function setTaskStatus(
  client: PoolClient,
  input: { orgId: string; userId?: string; taskId: string; status: TaskStatus; blockedReason?: string | null },
): Promise<void> {
  await updateStoredTask(client, {
    orgId: input.orgId,
    taskId: input.taskId,
    userId: input.userId ?? "",
    patch: { status: input.status, blockedReason: input.blockedReason ?? null },
  });
}

export async function updateTaskFields(
  client: PoolClient,
  input: {
    orgId: string;
    userId?: string;
    taskId: string;
    title?: string;
    subsystem?: string;
    priority?: TaskPriority;
    assignee?: string | null;
    estimateHours?: number | null;
    dueOn?: string | null;
  },
): Promise<void> {
  await updateStoredTask(client, {
    orgId: input.orgId,
    taskId: input.taskId,
    userId: input.userId ?? "",
    patch: {
      title: input.title,
      subsystem: input.subsystem,
      priority: input.priority,
      assignees: input.assignee === undefined ? undefined : input.assignee ? [input.assignee] : [],
      estimateHours: input.estimateHours,
      dueOn: input.dueOn,
    },
  });
}

export async function deleteTask(
  client: PoolClient,
  input: { orgId: string; taskId: string },
): Promise<void> {
  await deleteStoredTask(client, input);
}
