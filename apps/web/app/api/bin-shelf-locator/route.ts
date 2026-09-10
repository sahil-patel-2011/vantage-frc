import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  BIN_SHELF_LOCATION_KINDS,
  BIN_SHELF_MOVE_METHODS,
  archiveLocation,
  computeBinShelfLocatorView,
  createLocation,
  findItemLocations,
  recordMove,
  recordSighting,
  type BinShelfLocatorView,
} from "../../../lib/bin-shelf-locator/compute-bin-shelf-locator";
import type { BinShelfLocationKind, BinShelfMoveMethod } from "../../../lib/bin-shelf-locator/types";

export type { BinShelfLocatorView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function nonNegativeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const findItemId = url.searchParams.get("findItem");

  try {
    if (findItemId) {
      const result = await withRls({ userId: session.user.id, orgId: requestedOrg ?? undefined }, async (client) => {
        if (!requestedOrg) return null;
        const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
          requestedOrg,
          session.user.id,
        ]);
        if (!member.rowCount) return null;
        return findItemLocations(client, { orgId: requestedOrg, itemId: findItemId });
      });
      if (!result) return Response.json({ error: "Item not found" }, { status: 404 });
      return Response.json(result);
    }

    const view = await withRls({ userId: session.user.id }, (client) =>
      computeBinShelfLocatorView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the Bin/Shelf Locator. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies BinShelfLocatorView,
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

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "create-location": {
          const code = trimmedOrNull(body.code, 40);
          if (!code) throw new Error("code is required");
          const kind = oneOf<BinShelfLocationKind>(BIN_SHELF_LOCATION_KINDS, body.kind) ?? "bin";
          await createLocation(client, {
            orgId,
            userId,
            code,
            kind,
            zone: trimmedOrNull(body.zone, 100),
            photoUrl: trimmedOrNull(body.photoUrl, 4000),
            notes: trimmedOrNull(body.notes, 2000) ?? "",
          });
          break;
        }
        case "archive-location": {
          const locationId = trimmedOrNull(body.locationId, 64);
          if (!locationId) throw new Error("locationId is required");
          await archiveLocation(client, { orgId, locationId });
          break;
        }
        case "record-move": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          const fromLocationId = trimmedOrNull(body.fromLocationId, 64);
          const toLocationId = trimmedOrNull(body.toLocationId, 64);
          if (!fromLocationId && !toLocationId) throw new Error("fromLocationId or toLocationId is required");
          const method = oneOf<BinShelfMoveMethod>(BIN_SHELF_MOVE_METHODS, body.method) ?? "manual";
          await recordMove(client, {
            orgId,
            userId,
            itemId,
            fromLocationId,
            toLocationId,
            quantity: nonNegativeNumber(body.quantity),
            method,
            note: trimmedOrNull(body.note, 2000) ?? "",
          });
          break;
        }
        case "record-sighting": {
          const itemId = trimmedOrNull(body.itemId, 64);
          const locationId = trimmedOrNull(body.locationId, 64);
          if (!itemId) throw new Error("itemId is required");
          if (!locationId) throw new Error("locationId is required");
          await recordSighting(client, {
            orgId,
            userId,
            itemId,
            locationId,
            note: trimmedOrNull(body.note, 2000) ?? "",
          });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeBinShelfLocatorView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bin/Shelf Locator request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
