import {
  emitPreferredNotification,
  resolveAuthBaseURL,
  sendCoachAssignmentEmail,
  sendCoachTodoEmail,
} from "@vantage/core";
import type { PoolClient } from "@neondatabase/serverless";
import { asOfUtcDate, computeMetrics, sortTodos, withFlags } from "./evaluate";
import type { TeamTodo, TodoMember, TodoMetrics, TodoStatus, TodoSubteam } from "./types";
import { TODO_STATUSES } from "./types";

export { TODO_STATUSES };
export type { TodoStatus };

export type TodosSetupStep = { id: string; label: string; detail: string; href: string };

export type TodosView =
  | {
      status: "setup_required";
      message: string;
      steps: TodosSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      currentUserId: string;
      todos: TeamTodo[];
      members: TodoMember[];
      subteams: TodoSubteam[];
      metrics: TodoMetrics;
      focusTodoId: string | null;
      computedAt: string;
    };

type TodoRow = {
  id: string;
  title: string;
  notes: string;
  status: TodoStatus;
  assigneeUserId: string | null;
  assigneeName: string | null;
  subteamId: string | null;
  subteamName: string | null;
  subteamColor: string | null;
  dueOn: string | null;
  completedAt: string | null;
  completedBy: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
};

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
    `SELECT u.id AS "userId", u.name, m.role::text AS role
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
  const rows = await client.query<TodoRow>(
    `SELECT
       t.id,
       t.title,
       t.notes,
       t.status,
       t.assignee_user_id AS "assigneeUserId",
       a.name AS "assigneeName",
       t.subteam_id AS "subteamId",
       s.name AS "subteamName",
       s.color AS "subteamColor",
       t.due_on::text AS "dueOn",
       t.completed_at::text AS "completedAt",
       t.completed_by AS "completedBy",
       t.created_by AS "createdBy",
       c.name AS "createdByName",
       t.created_at::text AS "createdAt",
       t.updated_at::text AS "updatedAt"
     FROM team_todos t
     LEFT JOIN users a ON a.id = t.assignee_user_id
     LEFT JOIN users c ON c.id = t.created_by
     LEFT JOIN team_subteams s ON s.id = t.subteam_id AND s.org_id = t.org_id
     WHERE t.org_id = $1
     ORDER BY t.created_at DESC`,
    [orgId],
  );
  return sortTodos(rows.rows.map((row) => withFlags(row, asOf)));
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
    return {
      status: "live",
      orgId: org.orgId,
      teamNumber: org.teamNumber,
      currentUserId: input.userId,
      todos,
      members,
      subteams,
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

async function assertSubteam(client: PoolClient, orgId: string, subteamId: string | null): Promise<void> {
  if (!subteamId) return;
  const row = await client.query(`SELECT 1 FROM team_subteams WHERE org_id = $1 AND id = $2`, [
    orgId,
    subteamId,
  ]);
  if (!row.rowCount) throw new Error("Unknown subteam");
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
    status?: TodoStatus;
    assigneeUserId?: string | null;
    subteamId?: string | null;
    dueOn?: string | null;
  },
): Promise<string> {
  await assertMember(client, input.orgId, input.userId);
  await assertAssignee(client, input.orgId, input.assigneeUserId ?? null);
  await assertSubteam(client, input.orgId, input.subteamId ?? null);
  const status = input.status && TODO_STATUSES.includes(input.status) ? input.status : "todo";
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO team_todos
       (org_id, title, notes, status, assignee_user_id, subteam_id, due_on, created_by,
        completed_at, completed_by)
     VALUES (
       $1::uuid, $2, coalesce($3, ''), $4, $5::uuid, $6::uuid, $7::date, $8::uuid,
       CASE WHEN $4 = 'done' THEN now() ELSE NULL END,
       CASE WHEN $4 = 'done' THEN $8::uuid ELSE NULL END
     )
     RETURNING id`,
    [
      input.orgId,
      input.title,
      input.notes ?? "",
      status,
      input.assigneeUserId ?? null,
      input.subteamId ?? null,
      input.dueOn ?? null,
      input.userId,
    ],
  );
  const todoId = inserted.rows[0]!.id;
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
    status?: TodoStatus;
    assigneeUserId?: string | null;
    subteamId?: string | null;
    dueOn?: string | null;
  },
): Promise<void> {
  await assertMember(client, input.orgId, input.userId);
  const existing = await client.query<{
    title: string;
    status: TodoStatus;
    assigneeUserId: string | null;
    createdBy: string;
  }>(
    `SELECT title, status, assignee_user_id AS "assigneeUserId", created_by AS "createdBy"
     FROM team_todos WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.todoId, input.orgId],
  );
  const prev = existing.rows[0];
  if (!prev) throw new Error("Todo not found");

  if (input.assigneeUserId !== undefined) {
    await assertAssignee(client, input.orgId, input.assigneeUserId);
  }
  if (input.subteamId !== undefined) {
    await assertSubteam(client, input.orgId, input.subteamId);
  }

  const nextStatus = input.status ?? prev.status;
  const nextAssignee = input.assigneeUserId !== undefined ? input.assigneeUserId : prev.assigneeUserId;
  const nextTitle = input.title ?? prev.title;

  await client.query(
    `UPDATE team_todos SET
       title = coalesce($3, title),
       notes = CASE WHEN $4::boolean THEN coalesce($5, '') ELSE notes END,
       status = coalesce($6, status),
       assignee_user_id = CASE WHEN $7::boolean THEN $8::uuid ELSE assignee_user_id END,
       subteam_id = CASE WHEN $9::boolean THEN $10::uuid ELSE subteam_id END,
       due_on = CASE WHEN $11::boolean THEN $12::date ELSE due_on END,
       completed_at = CASE
         WHEN coalesce($6, status) = 'done' AND status <> 'done' THEN now()
         WHEN coalesce($6, status) <> 'done' THEN NULL
         ELSE completed_at
       END,
       completed_by = CASE
         WHEN coalesce($6, status) = 'done' AND status <> 'done' THEN $13::uuid
         WHEN coalesce($6, status) <> 'done' THEN NULL
         ELSE completed_by
       END,
       updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [
      input.todoId,
      input.orgId,
      input.title ?? null,
      input.notes !== undefined,
      input.notes ?? "",
      input.status ?? null,
      input.assigneeUserId !== undefined,
      input.assigneeUserId ?? null,
      input.subteamId !== undefined,
      input.subteamId ?? null,
      input.dueOn !== undefined,
      input.dueOn ?? null,
      input.userId,
    ],
  );

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
  const result = await client.query(`DELETE FROM team_todos WHERE id = $1::uuid AND org_id = $2::uuid`, [
    input.todoId,
    input.orgId,
  ]);
  if (!result.rowCount) throw new Error("Todo not found");
}
