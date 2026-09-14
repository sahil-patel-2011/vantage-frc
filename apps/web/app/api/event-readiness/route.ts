import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  addItem,
  assignItem,
  computeEventReadinessView,
  createPlan,
  deleteItem,
  setItemStatus,
  todayIsoDate,
  updateItem,
  type EventReadinessView,
} from "../../../lib/event-readiness/compute-event-readiness";
import { isIsoDate } from "../../../lib/event-readiness/schedule";
import {
  READINESS_CATEGORIES,
  READINESS_STATUSES,
  type ReadinessCategory,
  type ReadinessStatus,
} from "../../../lib/event-readiness/types";

export type { EventReadinessView };

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && isIsoDate(value) ? value : null;
}

function isoTimestampOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function nonNegativeIntOrNull(value: unknown, max = 365): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
}

function setupFallback(today: string): EventReadinessView {
  return {
    status: "setup_required",
    message: "Could not load event readiness. Choose your team and confirm database access.",
    steps: [
      { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
    ],
    orgId: null,
    teamNumber: null,
    eventCandidates: [],
    plans: [],
    today,
  };
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const eventKey = url.searchParams.get("eventKey");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeEventReadinessView(client, { userId: session.user.id, requestedOrg, eventKey }),
    );
    return Response.json(view);
  } catch {
    return Response.json(setupFallback(todayIsoDate()), { status: 200 });
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
  const eventKey = trimmedOrNull(body.eventKey, 80);

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "create-plan": {
          if (!eventKey) throw new Error("eventKey is required");
          await createPlan(client, {
            orgId,
            userId,
            eventKey,
            eventName: trimmedOrNull(body.eventName, 200),
            eventStartDate: isoDateOrNull(body.eventStartDate),
            travelDepartsAt: isoTimestampOrNull(body.travelDepartsAt),
            notes: trimmedOrNull(body.notes, 2000),
            seedTemplate: body.seedTemplate !== false,
          });
          break;
        }
        case "add-item": {
          const planId = trimmedOrNull(body.planId, 64);
          const title = trimmedOrNull(body.title, 240);
          if (!planId) throw new Error("planId is required");
          if (!title) throw new Error("title is required");
          await addItem(client, {
            orgId,
            userId,
            planId,
            category: oneOf<ReadinessCategory>(READINESS_CATEGORIES, body.category) ?? "other",
            title,
            detail: trimmedOrNull(body.detail, 2000),
            dueOn: isoDateOrNull(body.dueOn),
            daysBefore: isoDateOrNull(body.dueOn) ? null : nonNegativeIntOrNull(body.daysBefore),
          });
          break;
        }
        case "update-item": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          await updateItem(client, {
            orgId,
            itemId,
            title: trimmedOrNull(body.title, 240),
            detail: typeof body.detail === "string" ? body.detail.slice(0, 2000) : null,
            category: oneOf<ReadinessCategory>(READINESS_CATEGORIES, body.category),
            dueOn: isoDateOrNull(body.dueOn),
            daysBefore: nonNegativeIntOrNull(body.daysBefore),
            clearDates: body.clearDates === true,
          });
          break;
        }
        case "set-status": {
          const itemId = trimmedOrNull(body.itemId, 64);
          const status = oneOf<ReadinessStatus>(READINESS_STATUSES, body.status);
          if (!itemId) throw new Error("itemId is required");
          if (!status) throw new Error("status is required");
          await setItemStatus(client, {
            orgId,
            userId,
            itemId,
            status,
            blockedReason: trimmedOrNull(body.blockedReason, 500),
          });
          break;
        }
        case "assign": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          await assignItem(client, { orgId, itemId, ownerUserId: trimmedOrNull(body.ownerUserId, 64) });
          break;
        }
        case "delete-item": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          await deleteItem(client, { orgId, itemId });
          break;
        }
        case "refresh-rollup":
          // The roll-up is always read live; recomputing the view below is the refresh.
          break;
        default:
          throw new Error("Unknown action");
      }

      return computeEventReadinessView(client, { userId, requestedOrg: orgId, eventKey });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Event readiness request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
