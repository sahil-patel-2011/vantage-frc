import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { GOAL_CATEGORIES, GOAL_STATUSES } from "../../../lib/goals-tracker";
import {
  computeGoalsTrackerView,
  createGoal,
  currentSeasonYear,
  deleteGoal,
  logCheckin,
  updateGoalStatus,
  type GoalsTrackerView,
} from "../../../lib/goals-tracker/compute-goals-tracker";
import type { GoalCategory, GoalStatus } from "../../../lib/goals-tracker/types";

export type { GoalsTrackerView };

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

function numberOrDefault(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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
      computeGoalsTrackerView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Season Goals. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies GoalsTrackerView,
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
          const category = oneOf<GoalCategory>(GOAL_CATEGORIES, body.category) ?? "other";
          const metricUnit = trimmedOrNull(body.metricUnit, 40) ?? "percent";
          const startValue = numberOrDefault(body.startValue, 0);
          const targetValue = numberOrDefault(body.targetValue, 100) || 100;
          await createGoal(client, {
            orgId,
            userId,
            title,
            description: trimmedOrNull(body.description, 4000),
            category,
            metricUnit,
            startValue,
            targetValue,
            dueOn: isoDateOrNull(body.dueOn),
            seasonYear,
          });
          break;
        }
        case "log-checkin": {
          const goalId = trimmedOrNull(body.goalId, 64);
          const occurredOn = isoDateOrNull(body.occurredOn);
          if (!goalId) throw new Error("goalId is required");
          if (!occurredOn) throw new Error("occurredOn (YYYY-MM-DD) is required");
          const value = numberOrDefault(body.value, NaN);
          if (!Number.isFinite(value)) throw new Error("value is required");
          await logCheckin(client, {
            orgId,
            userId,
            goalId,
            value,
            note: trimmedOrNull(body.note, 2000),
            occurredOn,
          });
          break;
        }
        case "update-status": {
          const goalId = trimmedOrNull(body.goalId, 64);
          const status = oneOf<GoalStatus>(GOAL_STATUSES, body.status);
          if (!goalId) throw new Error("goalId is required");
          if (!status) throw new Error("status is required");
          await updateGoalStatus(client, { orgId, goalId, status });
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

      return computeGoalsTrackerView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Season Goals request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
