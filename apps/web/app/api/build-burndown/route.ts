import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { BUILD_TASK_CATEGORIES, BUILD_TASK_STATUSES, currentSeasonYear } from "../../../lib/build-burndown";
import {
  computeBuildBurndownView,
  createTask,
  deleteTask,
  setPlan,
  updateTaskStatus,
  type BuildBurndownView,
} from "../../../lib/build-burndown/compute-build-burndown";
import type { BuildTaskCategory, BuildTaskStatus } from "../../../lib/build-burndown/types";

export type { BuildBurndownView };

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
      computeBuildBurndownView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the build burndown. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies BuildBurndownView,
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
        case "set-plan": {
          const kickoffDate = isoDateOrNull(body.kickoffDate);
          const competitionDate = isoDateOrNull(body.competitionDate);
          if (!kickoffDate) throw new Error("kickoffDate (YYYY-MM-DD) is required");
          if (!competitionDate) throw new Error("competitionDate (YYYY-MM-DD) is required");
          if (competitionDate < kickoffDate) throw new Error("competitionDate must be on/after kickoffDate");
          await setPlan(client, { orgId, userId, seasonYear, kickoffDate, competitionDate });
          break;
        }
        case "create-task": {
          const title = trimmedOrNull(body.title, 200);
          const plannedDate = isoDateOrNull(body.plannedDate);
          if (!title) throw new Error("title is required");
          if (!plannedDate) throw new Error("plannedDate (YYYY-MM-DD) is required");
          const category = oneOf<BuildTaskCategory>(BUILD_TASK_CATEGORIES, body.category) ?? "other";
          await createTask(client, {
            orgId,
            userId,
            title,
            category,
            plannedDate,
            seasonYear,
            notes: trimmedOrNull(body.notes, 4000),
          });
          break;
        }
        case "update-status": {
          const taskId = trimmedOrNull(body.taskId, 64);
          const status = oneOf<BuildTaskStatus>(BUILD_TASK_STATUSES, body.status);
          if (!taskId) throw new Error("taskId is required");
          if (!status) throw new Error("status is required");
          await updateTaskStatus(client, { orgId, taskId, status });
          break;
        }
        case "delete-task": {
          const taskId = trimmedOrNull(body.taskId, 64);
          if (!taskId) throw new Error("taskId is required");
          await deleteTask(client, { orgId, taskId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeBuildBurndownView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Build burndown request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
