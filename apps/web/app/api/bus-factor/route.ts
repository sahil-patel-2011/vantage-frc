import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  BUS_FACTOR_AREAS,
  computeBusFactorView,
  DEFAULT_WINDOW_WEEKS,
  deleteWorkloadEntry,
  logWorkloadEntry,
  type BusFactorView,
} from "../../../lib/bus-factor/compute-bus-factor";
import type { BusFactorArea } from "../../../lib/bus-factor/types";

export type { BusFactorView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function trimmedOrNull(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function nonNegativeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function windowWeeksFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 && n <= 52 ? Math.round(n) : DEFAULT_WINDOW_WEEKS;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const windowParam = url.searchParams.get("weeks");
  const windowWeeks = windowParam ? windowWeeksFrom(windowParam) : null;

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeBusFactorView(client, { userId: session.user.id, requestedOrg, windowWeeks }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Bus factor. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        windowWeeks: windowWeeks ?? DEFAULT_WINDOW_WEEKS,
      } satisfies BusFactorView,
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
  const windowWeeks = windowWeeksFrom(body.windowWeeks);

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "log-entry": {
          const memberUserId = trimmedOrNull(body.memberUserId, 64);
          const weekStart = isoDateOrNull(body.weekStart);
          if (!memberUserId) throw new Error("memberUserId is required");
          if (!weekStart) throw new Error("weekStart (YYYY-MM-DD) is required");
          const area = oneOf<BusFactorArea>(BUS_FACTOR_AREAS, body.area) ?? "other";
          await logWorkloadEntry(client, {
            orgId,
            userId,
            memberUserId,
            area,
            weekStart,
            hoursLogged: nonNegativeNumber(body.hoursLogged),
            tasksOwned: nonNegativeNumber(body.tasksOwned),
            soleKnowledgeCount: nonNegativeNumber(body.soleKnowledgeCount),
          });
          break;
        }
        case "delete-entry": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!entryId) throw new Error("entryId is required");
          await deleteWorkloadEntry(client, { orgId, entryId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeBusFactorView(client, { userId, requestedOrg: orgId, windowWeeks });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bus factor request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
