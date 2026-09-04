import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  TODO_STATUSES,
  computeTodosView,
  createTodo,
  deleteTodo,
  updateTodo,
  type TodosView,
} from "../../../lib/todos/compute-todos";
import type { TodoStatus } from "../../../lib/todos/types";
import { requireAttachedLinks } from "../../../lib/planner/links";

export type { TodosView };

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function trimmedOrNull(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function uuidOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const focusTodoId = url.searchParams.get("todoId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeTodosView(client, {
        userId: session.user.id,
        requestedOrg,
        focusTodoId,
      }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load team todos. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
      } satisfies TodosView,
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

  const orgId = uuidOrNull(body.orgId) ?? trimmedOrNull(body.orgId, 64);
  const action = typeof body.action === "string" ? body.action : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  const userId = session.user.id;

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      switch (action) {
        case "create-todo": {
          const title = trimmedOrNull(body.title, 200);
          if (!title) throw new Error("title is required");
          const status = oneOf<TodoStatus>(TODO_STATUSES, body.status) ?? "todo";
          await createTodo(client, {
            orgId,
            userId,
            title,
            notes: body.notes === undefined ? "" : (trimmedOrNull(body.notes) ?? ""),
            status,
            assigneeUserId:
              body.assigneeUserId === undefined || body.assigneeUserId === ""
                ? null
                : uuidOrNull(body.assigneeUserId),
            subteamId:
              body.subteamId === undefined || body.subteamId === "" ? null : uuidOrNull(body.subteamId),
            dueOn: body.dueOn === undefined || body.dueOn === "" ? null : isoDateOrNull(body.dueOn),
            links: body.links === undefined ? [] : requireAttachedLinks(body.links),
          });
          break;
        }
        case "update-todo": {
          const todoId = uuidOrNull(body.todoId) ?? trimmedOrNull(body.todoId, 64);
          if (!todoId) throw new Error("todoId is required");
          const status =
            body.status === undefined ? undefined : (oneOf<TodoStatus>(TODO_STATUSES, body.status) ?? undefined);
          if (body.status !== undefined && status === undefined) throw new Error("Invalid status");
          if (body.assigneeUserId !== undefined && body.assigneeUserId !== null && body.assigneeUserId !== "") {
            if (!uuidOrNull(body.assigneeUserId)) throw new Error("Invalid assignee");
          }
          if (body.subteamId !== undefined && body.subteamId !== null && body.subteamId !== "") {
            if (!uuidOrNull(body.subteamId)) throw new Error("Invalid subteam");
          }
          await updateTodo(client, {
            orgId,
            userId,
            todoId,
            title: body.title === undefined ? undefined : (trimmedOrNull(body.title, 200) ?? undefined),
            notes: body.notes === undefined ? undefined : (trimmedOrNull(body.notes) ?? ""),
            status,
            assigneeUserId:
              body.assigneeUserId === undefined
                ? undefined
                : body.assigneeUserId === null || body.assigneeUserId === ""
                  ? null
                  : uuidOrNull(body.assigneeUserId),
            subteamId:
              body.subteamId === undefined
                ? undefined
                : body.subteamId === null || body.subteamId === ""
                  ? null
                  : uuidOrNull(body.subteamId),
            dueOn:
              body.dueOn === undefined
                ? undefined
                : body.dueOn === null || body.dueOn === ""
                  ? null
                  : isoDateOrNull(body.dueOn),
            links: body.links === undefined ? undefined : requireAttachedLinks(body.links),
          });
          break;
        }
        case "delete-todo": {
          const todoId = uuidOrNull(body.todoId) ?? trimmedOrNull(body.todoId, 64);
          if (!todoId) throw new Error("todoId is required");
          await deleteTodo(client, { orgId, userId, todoId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeTodosView(client, {
        userId,
        requestedOrg: orgId,
        focusTodoId: typeof body.todoId === "string" ? body.todoId : null,
      });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Team todos request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
