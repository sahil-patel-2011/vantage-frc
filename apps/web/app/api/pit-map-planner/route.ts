import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  PIT_MAP_CATEGORIES,
  addItem,
  computePitMapPlannerView,
  currentSeasonYear,
  deleteItem,
  updateItemPosition,
  upsertLayout,
  type PitMapPlannerView,
} from "../../../lib/pit-map-planner/compute-pit-map-planner";
import type { PitMapItemCategory } from "../../../lib/pit-map-planner/types";

export type { PitMapPlannerView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function positiveNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function nonNegativeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function numberOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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
      computePitMapPlannerView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Pit map. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies PitMapPlannerView,
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
        case "set-layout": {
          await upsertLayout(client, {
            orgId,
            userId,
            seasonYear,
            footprintWidthFt: positiveNumber(body.footprintWidthFt, 10),
            footprintDepthFt: positiveNumber(body.footprintDepthFt, 10),
            powerCapacityAmps: nonNegativeNumber(body.powerCapacityAmps, 20),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "add-item": {
          const name = trimmedOrNull(body.name, 200);
          if (!name) throw new Error("name is required");
          const category = oneOf<PitMapItemCategory>(PIT_MAP_CATEGORIES, body.category) ?? "other";
          await addItem(client, {
            orgId,
            userId,
            seasonYear,
            name,
            category,
            xFt: numberOrZero(body.xFt),
            yFt: numberOrZero(body.yFt),
            widthFt: positiveNumber(body.widthFt, 2),
            depthFt: positiveNumber(body.depthFt, 2),
            powerDrawAmps: nonNegativeNumber(body.powerDrawAmps, 0),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "move-item": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          await updateItemPosition(client, {
            orgId,
            itemId,
            xFt: numberOrZero(body.xFt),
            yFt: numberOrZero(body.yFt),
          });
          break;
        }
        case "delete-item": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          await deleteItem(client, { orgId, itemId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computePitMapPlannerView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pit map request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
