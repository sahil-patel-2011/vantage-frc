import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { failDbWrite } from "../../../lib/db-error";
import {
  EVENT_DAY_PLAN_KINDS,
  addBlock,
  computeEventDayPlanView,
  deleteBlock,
  todayIsoDate,
  updateBlockStatus,
  type EventDayPlanView,
} from "../../../lib/event-day-plan/compute-event-day-plan";
import type { EventDayPlanKind, EventDayPlanStatus } from "../../../lib/event-day-plan/types";

export type { EventDayPlanView };

const EVENT_DAY_PLAN_STATUSES: EventDayPlanStatus[] = ["planned", "in_progress", "done", "cancelled"];

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function isoTimestampOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const eventKey = url.searchParams.get("eventKey");
  const planDate = isoDateOrNull(url.searchParams.get("planDate"));

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeEventDayPlanView(client, { userId: session.user.id, requestedOrg, eventKey, planDate }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the event-day plan. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        eventKey: null,
        planDate: planDate ?? todayIsoDate(),
      } satisfies EventDayPlanView,
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
  const eventKey = trimmedOrNull(body.eventKey, 40);
  const planDate = isoDateOrNull(body.planDate) ?? todayIsoDate();

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "add-block": {
          if (!eventKey) throw new Error("eventKey is required");
          const title = trimmedOrNull(body.title, 200);
          const startAt = isoTimestampOrNull(body.startAt);
          const endAt = isoTimestampOrNull(body.endAt);
          if (!title) throw new Error("title is required");
          if (!startAt) throw new Error("startAt is required");
          if (!endAt) throw new Error("endAt is required");
          if (endAt <= startAt) throw new Error("endAt must be after startAt");
          const kind = oneOf<EventDayPlanKind>(EVENT_DAY_PLAN_KINDS, body.kind) ?? "other";
          await addBlock(client, {
            orgId,
            userId,
            eventKey,
            planDate,
            kind,
            title,
            startAt,
            endAt,
            assignedTo: trimmedOrNull(body.assignedTo, 120),
            location: trimmedOrNull(body.location, 120),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "update-status": {
          const blockId = trimmedOrNull(body.blockId, 64);
          const status = oneOf<EventDayPlanStatus>(EVENT_DAY_PLAN_STATUSES, body.status);
          if (!blockId) throw new Error("blockId is required");
          if (!status) throw new Error("status is required");
          await updateBlockStatus(client, { orgId, blockId, status });
          break;
        }
        case "delete-block": {
          const blockId = trimmedOrNull(body.blockId, 64);
          if (!blockId) throw new Error("blockId is required");
          await deleteBlock(client, { orgId, blockId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeEventDayPlanView(client, { userId, requestedOrg: orgId, eventKey, planDate });
    });

    return Response.json(view);
  } catch (error) {
    // Rows here are keyed to an event/match that references events_ref, so an
    // event not yet ingested from TBA raised a 23503 whose raw constraint text
    // went straight to the user. failDbWrite names the fix, and keeps the
    // previous behaviour for every other error.
    return failDbWrite(error, "Event-day plan request failed");
  }
}
