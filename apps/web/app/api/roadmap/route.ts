import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  RoadmapNotConfiguredError,
  computeRoadmapView,
  saveSettings,
  saveTaskStatus,
  setupRequired,
  type RoadmapView,
} from "../../../lib/roadmap/load-roadmap";
import { isTaskStatus, parseIsoDate, taskById } from "../../../lib/roadmap/season-roadmap";

export type { RoadmapView };

/** "Today" as an ISO date. Kept here so the compute module stays clock-free. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function trimmedOrNull(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const requestedOrg = params.get("orgId");
  const rookieParam = params.get("rookieOnly");
  const rookieOverride = rookieParam === "1" ? true : rookieParam === "0" ? false : null;

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeRoadmapView(client, {
        userId: session.user.id,
        requestedOrg,
        today: todayIso(),
        rookieOverride,
      }),
    );
    return Response.json(view);
  } catch {
    // Product routes degrade to a setup state rather than crashing without a DB.
    return Response.json(setupRequired(requestedOrg), { status: 200 });
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
  const rookieOverride = booleanOrNull(body.rookieOnly);

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(
        `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
        [orgId, userId],
      );
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "set-kickoff": {
          // Empty string clears the date; the page then goes back to relative phrasing
          // ("about 8 weeks before kickoff") instead of showing invented dates.
          const raw = typeof body.kickoffDate === "string" ? body.kickoffDate.trim() : "";
          const kickoffDate = raw === "" ? null : raw;
          if (kickoffDate !== null && parseIsoDate(kickoffDate) == null) {
            throw new Error("bad-date");
          }
          await saveSettings(client, {
            orgId,
            userId,
            kickoffDate,
            rookieOnly: rookieOverride,
          });
          break;
        }
        case "set-rookie-filter": {
          const current = await client.query<{ kickoffDate: unknown }>(
            `SELECT kickoff_date AS "kickoffDate" FROM season_roadmap_settings WHERE org_id = $1::uuid`,
            [orgId],
          );
          const existing = current.rows[0]?.kickoffDate;
          const kickoffDate =
            existing instanceof Date
              ? existing.toISOString().slice(0, 10)
              : typeof existing === "string"
                ? existing.slice(0, 10)
                : null;
          await saveSettings(client, { orgId, userId, kickoffDate, rookieOnly: rookieOverride });
          break;
        }
        case "set-task": {
          const taskId = trimmedOrNull(body.taskId, 120);
          const status = body.status;
          if (!taskId || !taskById(taskId)) throw new Error("bad-task");
          if (!isTaskStatus(status)) throw new Error("bad-status");
          await saveTaskStatus(client, {
            orgId,
            userId,
            taskId,
            status,
            note: trimmedOrNull(body.note, 2000),
          });
          break;
        }
        default:
          throw new Error("bad-action");
      }

      return computeRoadmapView(client, {
        userId,
        requestedOrg: orgId,
        today: todayIso(),
        rookieOverride,
      });
    });
    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "forbidden") return Response.json({ error: "Forbidden" }, { status: 403 });
    if (message === "bad-action") return Response.json({ error: "Unknown action" }, { status: 400 });
    if (message === "bad-task") return Response.json({ error: "Unknown task" }, { status: 400 });
    if (message === "bad-status") return Response.json({ error: "Unknown status" }, { status: 400 });
    if (message === "bad-date") {
      return Response.json({ error: "Enter the kickoff date as YYYY-MM-DD." }, { status: 400 });
    }
    if (error instanceof RoadmapNotConfiguredError) {
      return Response.json(
        { error: "The season roadmap tables are not set up in this environment yet." },
        { status: 503 },
      );
    }
    return Response.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
