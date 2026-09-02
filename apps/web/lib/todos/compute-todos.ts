// Soft-UI todo list over the merged task store (build_tasks, migration 0502).
// This file keeps the list's shape and its assign/complete notifications; every
// read and write goes through lib/tasks/store so /todos and the board agree.

import {
  emitPreferredNotification,
  resolveAuthBaseURL,
  sendCoachAssignmentEmail,
  sendCoachTodoEmail,
} from "@vantage/core";
import type { PoolClient } from "@neondatabase/serverless";
import { canonicalStatus, coarseStatus } from "../tasks/status-map";
import {
  deleteTask as deleteStoredTask,
  getTask,
  insertTask,
  listTasks,
  updateTask as updateStoredTask,
  type StoredTask,
  type TaskPatch,
} from "../tasks/store";
import type { TaskPriority, TaskStatus } from "../tasks/types";
import { asOfUtcDate, computeMetrics, sortTodos, withFlags } from "./evaluate";
import type { TeamTodo, TodoMember, TodoStatus, TodoSubteam, TodosView } from "./types";
import { TODO_STATUSES } from "./types";

export { TODO_STATUSES };
export type { TodoStatus, TodosSetupStep, TodosView } from "./types";

function seasonYearNow(): number {
  return new Date().getUTCFullYear();
}

export function toTeamTodo(task: StoredTask): Omit<TeamTodo, "flags"> {
  return {
    id: task.id,
    title: task.title,
    notes: task.notes ?? "",
    status: coarseStatus(task.status),
    taskStatus: task.status,
    priority: task.priority,
    subsystem: task.subsystem,
    assignees: task.assignees,
    blockedReason: task.blockedReason,
    estimateHours: task.estimateHours,
    seasonYear: task.seasonYear,
    assigneeUserId: task.assigneeUserId,
    // A member link wins; otherwise the board's first free-text collaborator.
    assigneeName: task.assigneeUserId ? task.assigneeName : (task.assignees[0] ?? null),
    subteamId: task.subteamId,
    subteamName: task.subteamName,
    subteamColor: task.subteamColor,
    dueOn: task.dueOn,
    completedAt: task.doneAt,
    completedBy: task.completedBy,
    createdBy: task.createdBy,
    createdByName: task.createdByName,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
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

async function loadMembers(client: PoolClient, orgId: string): Promise<TodoMember[]> {
  const rows = await client.query<TodoMember>(
    `SELECT u.id AS "userId", COALESCE(NULLIF(btrim(u.name), ''), u.email) AS name, m.role::text AS role
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1
     ORDER BY lower(u.name), u.id`,
    [orgId],
  );
  return rows.rows;
}

async function loadSubteams(client: PoolClient, orgId: string): Promise<TodoSubteam[]> {
  try {
    const rows = await client.query<TodoSubteam>(
      `SELECT id, name, color
       FROM team_subteams
       WHERE org_id = $1
       ORDER BY sort_order, lower(name)`,
      [orgId],
    );
    return rows.rows;
  } catch {
    // Calendar subteams migration may be absent in some environments.
    return [];
  }
}

async function loadTodos(client: PoolClient, orgId: string, asOf: string): Promise<TeamTodo[]> {
  const tasks = await listTasks(client, { orgId, seasonYear: null, includeArchived: true });
  return sortTodos(tasks.map((task) => withFlags(toTeamTodo(task), asOf)));
}

export async function computeTodosView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; focusTodoId?: string | null },
): Promise<TodosView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to manage shared todos.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        { id: "calendar", label: "Open Calendar", detail: "Plan due dates and subteams once the workspace is set", href: "/team?tab=calendar" },
        { id: "messages", label: "Open Messages", detail: "Ask teammates for owners when assignments are unclear", href: "/team?tab=messages" },
      ],
      orgId: null,
    };
  }

  const asOf = asOfUtcDate();
  try {
    const [todos, members, subteams] = await Promise.all([
      loadTodos(client, org.orgId, asOf),
      loadMembers(client, org.orgId),
      loadSubteams(client, org.orgId),
    ]);
    const focusTodoId =
      input.focusTodoId && todos.some((item) => item.id === input.focusTodoId) ? input.focusTodoId : null;
    const subsystems = [...new Set(todos.map((item) => item.subsystem).filter(Boolean))].sort();
    return {
      status: "live",
      orgId: org.orgId,
      teamNumber: org.teamNumber,
      currentUserId: input.userId,
      todos,
      members,
      subteams,
      subsystems,
      metrics: computeMetrics(todos, input.userId),
      focusTodoId,
      computedAt: new Date().toISOString(),
    };
  } catch {
    return {
      status: "setup_required",
      message: "Could not load team todos. Confirm database migrations have been applied.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        { id: "practice", label: "Open Practice", detail: "Drive sessions often create follow-up todos after logs exist", href: "/team?tab=practice" },
      ],
      orgId: org.orgId,
    };
  }
}

async function assertMember(client: PoolClient, orgId: string, userId: string): Promise<void> {
  const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
    orgId,
    userId,
  ]);
  if (!member.rowCount) throw new Error("forbidden");
}

async function assertAssignee(client: PoolClient, orgId: string, assigneeUserId: string | null): Promise<void> {
  if (!assigneeUserId) return;
  const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
    orgId,
    assigneeUserId,
  ]);
  if (!member.rowCount) throw new Error("Assignee must be an organization member");
}

function todoHref(orgId: string, todoId: string): string {
  return `/todos?orgId=${encodeURIComponent(orgId)}&todoId=${encodeURIComponent(todoId)}`;
}

async function notifyAssigned(
  client: PoolClient,
  input: {
    orgId: string;
    actorUserId: string;
    assigneeUserId: string;
    todoId: string;
    title: string;
  },
): Promise<void> {
  if (input.assigneeUserId === input.actorUserId) return;
  const actor = await client.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [
    input.actorUserId,
  ]);
  const org = await client.query<{ name: string }>(`SELECT name FROM organizations WHERE id = $1`, [
    input.orgId,
  ]);
  const summary = `${actor.rows[0]?.name ?? "A teammate"} assigned “${input.title}”.`;
  const relativeHref = todoHref(input.orgId, input.todoId);
  await emitPreferredNotification(client, {
    userId: input.assigneeUserId,
    orgId: input.orgId,
    type: "todo_assigned",
    payload: {
      title: "Todo assigned to you",
      body: summary,
      todoId: input.todoId,
      href: relativeHref,
    },
  });
  // Consent-gated opt-in emails; skipped when the member has not opted in.
  const absoluteHref = `${resolveAuthBaseURL()}${relativeHref}`;
  await sendCoachAssignmentEmail(client, {
    userId: input.assigneeUserId,
    orgName: org.rows[0]?.name ?? "Your team",
    summary,
    href: absoluteHref,
  });
  await sendCoachTodoEmail(client, {
    userId: input.assigneeUserId,
    orgName: org.rows[0]?.name ?? "Your team",
    summary,
    href: absoluteHref,
  });
}

async function notifyCompleted(
  client: PoolClient,
  input: {
    orgId: string;
    actorUserId: string;
    notifyUserId: string;
    todoId: string;
    title: string;
  },
): Promise<void> {
  if (input.notifyUserId === input.actorUserId) return;
  const actor = await client.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [
    input.actorUserId,
  ]);
  await emitPreferredNotification(client, {
    userId: input.notifyUserId,
    orgId: input.orgId,
    type: "todo_completed",
    payload: {
      title: "Todo completed",
      body: `${actor.rows[0]?.name ?? "A teammate"} marked “${input.title}” done.`,
      todoId: input.todoId,
      href: todoHref(input.orgId, input.todoId),
    },
  });
}

export async function createTodo(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    title: string;
    notes?: string | null;
    /** Coarse list status; ignored when taskStatus is given. */
    status?: TodoStatus;
    taskStatus?: TaskStatus;
    priority?: TaskPriority;
    subsystem?: string | null;
    assignees?: string[];
    estimateHours?: number | null;
    assigneeUserId?: string | null;
    subteamId?: string | null;
    dueOn?: string | null;
    seasonYear?: number;
  },
): Promise<string> {
  await assertMember(client, input.orgId, input.userId);
  await assertAssignee(client, input.orgId, input.assigneeUserId ?? null);
  const coarse = input.status && TODO_STATUSES.includes(input.status) ? input.status : "todo";
  const status = input.taskStatus ?? canonicalStatus(coarse, null);
  const todoId = await insertTask(client, {
    orgId: input.orgId,
    userId: input.userId,
    title: input.title,
    seasonYear: input.seasonYear ?? seasonYearNow(),
    subsystem: input.subsystem ?? null,
    status,
    priority: input.priority,
    notes: input.notes ?? null,
    assignees: input.assignees,
    assigneeUserId: input.assigneeUserId ?? null,
    subteamId: input.subteamId ?? null,
    estimateHours: input.estimateHours ?? null,
    dueOn: input.dueOn ?? null,
  });
  if (input.assigneeUserId) {
    await notifyAssigned(client, {
      orgId: input.orgId,
      actorUserId: input.userId,
      assigneeUserId: input.assigneeUserId,
      todoId,
      title: input.title,
    });
  }
  return todoId;
}

export async function updateTodo(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    todoId: string;
    title?: string;
    notes?: string | null;
    /** Coarse list status; ignored when taskStatus is given. */
    status?: TodoStatus;
    taskStatus?: TaskStatus;
    blockedReason?: string | null;
    priority?: TaskPriority;
    subsystem?: string;
    assignees?: string[];
    estimateHours?: number | null;
    assigneeUserId?: string | null;
    subteamId?: string | null;
    dueOn?: string | null;
  },
): Promise<void> {
  await assertMember(client, input.orgId, input.userId);
  const prev = await getTask(client, { orgId: input.orgId, taskId: input.todoId });
  if (!prev) throw new Error("Todo not found");

  if (input.assigneeUserId !== undefined) {
    await assertAssignee(client, input.orgId, input.assigneeUserId);
  }

  const nextStatus: TaskStatus | undefined =
    input.taskStatus ?? (input.status !== undefined ? canonicalStatus(input.status, prev.status) : undefined);
  const patch: TaskPatch = {
    title: input.title,
    notes: input.notes,
    status: nextStatus,
    blockedReason: input.blockedReason,
    priority: input.priority,
    subsystem: input.subsystem,
    assignees: input.assignees,
    estimateHours: input.estimateHours,
    assigneeUserId: input.assigneeUserId,
    subteamId: input.subteamId,
    dueOn: input.dueOn,
  };
  await updateStoredTask(client, { orgId: input.orgId, taskId: input.todoId, userId: input.userId, patch });

  const after = await getTask(client, { orgId: input.orgId, taskId: input.todoId });
  const nextAssignee = after?.assigneeUserId ?? null;
  const nextTitle = after?.title ?? prev.title;

  if (nextAssignee && nextAssignee !== prev.assigneeUserId) {
    await notifyAssigned(client, {
      orgId: input.orgId,
      actorUserId: input.userId,
      assigneeUserId: nextAssignee,
      todoId: input.todoId,
      title: nextTitle,
    });
  }

  if (nextStatus === "done" && prev.status !== "done") {
    const recipients = new Set<string>();
    if (prev.createdBy) recipients.add(prev.createdBy);
    if (nextAssignee) recipients.add(nextAssignee);
    for (const notifyUserId of recipients) {
      await notifyCompleted(client, {
        orgId: input.orgId,
        actorUserId: input.userId,
        notifyUserId,
        todoId: input.todoId,
        title: nextTitle,
      });
    }
  }
}

export async function deleteTodo(
  client: PoolClient,
  input: { orgId: string; userId: string; todoId: string },
): Promise<void> {
  await assertMember(client, input.orgId, input.userId);
  const removed = await deleteStoredTask(client, { orgId: input.orgId, taskId: input.todoId });
  if (!removed) throw new Error("Todo not found");
}
