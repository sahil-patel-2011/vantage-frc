import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  GOAL_CATEGORIES,
  WORK_ITEM_STATUSES,
  buildSeasonPlanningIcs,
  computeSeasonPlanningWorkspaceView,
  createSeasonGoal,
  createSeasonMilestone,
  createSeasonPlan,
  currentSeasonYear,
  updateSeasonGoalStatus,
  updateSeasonMilestoneStatus,
  type SeasonPlanningWorkspaceView,
} from "../../../lib/season-planning-workspace";
import type { GoalCategory, WorkItemStatus } from "../../../lib/season-planning-workspace/types";

export type { SeasonPlanningWorkspaceView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
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

function dateOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const day = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

const SETUP_FALLBACK: SeasonPlanningWorkspaceView = {
  status: "setup_required",
  message: "Could not load Season Planning Workspace. Select a workspace and confirm database access.",
  steps: [{ id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" }],
  orgId: null,
  seasonYear: currentSeasonYear(),
};

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonParam = url.searchParams.get("season");
  const planId = url.searchParams.get("planId");
  const seasonYear = seasonParam ? seasonFrom(seasonParam) : null;
  const format = url.searchParams.get("format");

  try {
    if (format === "ics") {
      const ics = await withRls({ userId: session.user.id }, async (client) => {
        const view = await computeSeasonPlanningWorkspaceView(client, {
          userId: session.user.id,
          requestedOrg,
          seasonYear,
          planId,
        });
        if (view.status !== "live") return null;
        const orgResult = await client.query<{ name: string | null }>(
          `SELECT name FROM organizations WHERE id = $1`,
          [view.orgId],
        );
        return buildSeasonPlanningIcs(client, {
          orgId: view.orgId,
          planId: view.plan.id,
          teamNumber: view.teamNumber,
          orgName: orgResult.rows[0]?.name ?? null,
          seasonYear: view.seasonYear,
        });
      });
      if (!ics) return Response.json({ error: "Select a workspace and plan first" }, { status: 400 });
      return new Response(ics, {
        headers: {
          "content-type": "text/calendar; charset=utf-8",
          "content-disposition": 'attachment; filename="season-planning.ics"',
        },
      });
    }

    const view = await withRls({ userId: session.user.id }, (client) =>
      computeSeasonPlanningWorkspaceView(client, {
        userId: session.user.id,
        requestedOrg,
        seasonYear,
        planId,
      }),
    );
    return Response.json(view);
  } catch {
    return Response.json({ ...SETUP_FALLBACK, seasonYear: seasonYear ?? currentSeasonYear() }, { status: 200 });
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
  let activePlan = trimmedOrNull(body.planId, 64);

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "create-plan": {
          const title = trimmedOrNull(body.title, 160) ?? `${seasonYear} Season Plan`;
          activePlan = await createSeasonPlan(client, {
            orgId,
            userId,
            seasonYear,
            title,
            notes: trimmedOrNull(body.notes, 4000),
          });
          break;
        }
        case "create-goal": {
          if (!activePlan) throw new Error("planId is required");
          const title = trimmedOrNull(body.title, 200);
          const category = oneOf(GOAL_CATEGORIES, body.category) as GoalCategory | null;
          if (!title || !category) throw new Error("title and category are required");
          await createSeasonGoal(client, {
            orgId,
            userId,
            planId: activePlan,
            title,
            category,
            ownerUserId: trimmedOrNull(body.ownerUserId, 64),
            targetDate: dateOrNull(body.targetDate),
          });
          break;
        }
        case "set-goal-status": {
          const goalId = trimmedOrNull(body.goalId, 64);
          const status = oneOf(WORK_ITEM_STATUSES, body.status) as WorkItemStatus | null;
          if (!goalId || !status) throw new Error("goalId and status are required");
          await updateSeasonGoalStatus(client, { orgId, goalId, status });
          break;
        }
        case "create-milestone": {
          if (!activePlan) throw new Error("planId is required");
          const goalId = trimmedOrNull(body.goalId, 64);
          const title = trimmedOrNull(body.title, 200);
          if (!goalId || !title) throw new Error("goalId and title are required");
          await createSeasonMilestone(client, {
            orgId,
            userId,
            planId: activePlan,
            goalId,
            title,
            dueOn: dateOrNull(body.dueOn),
            ownerUserId: trimmedOrNull(body.ownerUserId, 64),
            calendarEventUid: trimmedOrNull(body.calendarEventUid, 120),
          });
          break;
        }
        case "set-milestone-status": {
          const milestoneId = trimmedOrNull(body.milestoneId, 64);
          const status = oneOf(WORK_ITEM_STATUSES, body.status) as WorkItemStatus | null;
          if (!milestoneId || !status) throw new Error("milestoneId and status are required");
          await updateSeasonMilestoneStatus(client, { orgId, milestoneId, status });
          break;
        }
        default:
          throw new Error(`Unknown action: ${action || "(empty)"}`);
      }

      return computeSeasonPlanningWorkspaceView(client, {
        userId,
        requestedOrg: orgId,
        seasonYear,
        planId: activePlan,
      });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    if (message === "forbidden") return Response.json({ error: "Forbidden" }, { status: 403 });
    return Response.json({ error: message }, { status: 400 });
  }
}
