import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  computeTasksView,
  createTask,
  currentSeasonYear,
  deleteTask,
  replaceTaskAssignees,
  setTaskStatus,
  updateTaskFields,
  type TasksView,
} from "../../../lib/tasks/compute-tasks";
import type { TaskPriority, TaskStatus } from "../../../lib/tasks/types";

export type { TasksView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function estimateOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

function assigneesFrom(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(values.map((entry) => trimmedOrNull(entry,120)).filter((entry): entry is string => Boolean(entry)))].slice(0,12);
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonParam = url.searchParams.get("season");
  const seasonYear = seasonParam ? seasonFrom(seasonParam) : null;

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeTasksView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the task board. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies TasksView,
      { status: 200 },
    );
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgId = trimmedOrNull(body.orgId, 64);
  const action = typeof body.action === "string" ? body.action : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  const userId = session.user.id;
  const seasonYear = seasonFrom(body.seasonYear);

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "create-task": {
          const title = trimmedOrNull(body.title, 200);
          if (!title) throw new Error("title is required");
          await createTask(client, {
            orgId,
            userId,
            title,
            subsystem: trimmedOrNull(body.subsystem, 60) ?? "general",
            priority: oneOf<TaskPriority>(TASK_PRIORITIES, body.priority) ?? "normal",
            assignee: trimmedOrNull(body.assignee, 120),
            assignees: assigneesFrom(body.assignees ?? body.assignee),
            estimateHours: estimateOrNull(body.estimateHours),
            dueOn: isoDateOrNull(body.dueOn),
            seasonYear,
          });
          break;
        }
        case "set-status": {
          const taskId = trimmedOrNull(body.taskId, 64);
          const status = oneOf<TaskStatus>(TASK_STATUSES, body.status);
          if (!taskId) throw new Error("taskId is required");
          if (!status) throw new Error("Invalid status");
          await setTaskStatus(client, {
            orgId,
            taskId,
            status,
            blockedReason: trimmedOrNull(body.blockedReason, 500),
          });
          break;
        }
        case "update-task": {
          const taskId = trimmedOrNull(body.taskId, 64);
          if (!taskId) throw new Error("taskId is required");
          const priority = body.priority === undefined ? undefined : oneOf<TaskPriority>(TASK_PRIORITIES, body.priority);
          if (body.priority !== undefined && !priority) throw new Error("Invalid priority");
          await updateTaskFields(client, {
            orgId,
            taskId,
            title: body.title === undefined ? undefined : (trimmedOrNull(body.title, 200) ?? undefined),
            subsystem: body.subsystem === undefined ? undefined : (trimmedOrNull(body.subsystem, 60) ?? undefined),
            priority: priority ?? undefined,
            assignee: body.assignee === undefined ? undefined : trimmedOrNull(body.assignee, 120),
            estimateHours: body.estimateHours === undefined ? undefined : estimateOrNull(body.estimateHours),
            dueOn: body.dueOn === undefined ? undefined : isoDateOrNull(body.dueOn),
          });
          if(body.assignees !== undefined) await replaceTaskAssignees(client,{orgId,taskId,userId,assignees:assigneesFrom(body.assignees)});
          break;
        }
        case "delete-task": {
          const taskId = trimmedOrNull(body.taskId, 64);
          if (!taskId) throw new Error("taskId is required");
          await deleteTask(client, { orgId, taskId });
          break;
        }
        case "set-benchmark-opt-in": {
          const allowed = await client.query<{ allowed: boolean }>(
            `SELECT has_org_role($1,ARRAY['owner','admin']::org_role[]) AS allowed`,[orgId]);
          if(!allowed.rows[0]?.allowed) throw new Error("Owner or admin role required");
          await client.query(
            `INSERT INTO org_ops_benchmark_settings(org_id,opted_in,updated_by) VALUES($1,$2,$3)
             ON CONFLICT(org_id) DO UPDATE SET opted_in=excluded.opted_in,updated_by=excluded.updated_by,updated_at=now()`,
            [orgId,body.optedIn===true,userId],
          );
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeTasksView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task board request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
