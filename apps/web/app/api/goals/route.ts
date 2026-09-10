import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  GOAL_CATEGORIES,
  GOAL_PRIORITIES,
  METRIC_TYPES,
  computeGoalsView,
  createGoal,
  currentSeasonYear,
  deleteGoal,
  updateGoal,
  type GoalsView,
} from "../../../lib/goals/compute-goals";
import type { GoalCategory, GoalPriority, MetricType } from "../../../lib/goals/types";

export type { GoalsView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function trimmedOrNull(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
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
      computeGoalsView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load season goals. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies GoalsView,
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
        case "create-goal": {
          const title = trimmedOrNull(body.title, 200);
          if (!title) throw new Error("title is required");
          const metricType = oneOf<MetricType>(METRIC_TYPES, body.metricType) ?? "count";
          await createGoal(client, {
            orgId,
            userId,
            seasonYear,
            title,
            category: oneOf<GoalCategory>(GOAL_CATEGORIES, body.category) ?? "other",
            metricType,
            targetValue: numberOrNull(body.targetValue) ?? (metricType === "binary" ? 1 : 0),
            currentValue: numberOrNull(body.currentValue) ?? 0,
            unit: trimmedOrNull(body.unit, 40),
            dueOn: isoDateOrNull(body.dueOn),
            priority: oneOf<GoalPriority>(GOAL_PRIORITIES, body.priority) ?? "normal",
            notes: trimmedOrNull(body.notes),
          });
          break;
        }
        case "update-goal": {
          const goalId = trimmedOrNull(body.goalId, 64);
          if (!goalId) throw new Error("goalId is required");
          const category = body.category === undefined ? undefined : oneOf<GoalCategory>(GOAL_CATEGORIES, body.category);
          if (body.category !== undefined && !category) throw new Error("Invalid category");
          const metricType = body.metricType === undefined ? undefined : oneOf<MetricType>(METRIC_TYPES, body.metricType);
          if (body.metricType !== undefined && !metricType) throw new Error("Invalid metric type");
          const priority = body.priority === undefined ? undefined : oneOf<GoalPriority>(GOAL_PRIORITIES, body.priority);
          if (body.priority !== undefined && !priority) throw new Error("Invalid priority");
          await updateGoal(client, {
            orgId,
            goalId,
            title: body.title === undefined ? undefined : (trimmedOrNull(body.title, 200) ?? undefined),
            category: category ?? undefined,
            metricType: metricType ?? undefined,
            targetValue: body.targetValue === undefined ? undefined : (numberOrNull(body.targetValue) ?? undefined),
            currentValue: body.currentValue === undefined ? undefined : (numberOrNull(body.currentValue) ?? undefined),
            unit: body.unit === undefined ? undefined : trimmedOrNull(body.unit, 40),
            dueOn: body.dueOn === undefined ? undefined : (isoDateOrNull(body.dueOn) ?? undefined),
            priority: priority ?? undefined,
            notes: body.notes === undefined ? undefined : trimmedOrNull(body.notes),
          });
          break;
        }
        case "delete-goal": {
          const goalId = trimmedOrNull(body.goalId, 64);
          if (!goalId) throw new Error("goalId is required");
          await deleteGoal(client, { orgId, goalId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeGoalsView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Season goals request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
