import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  KANBAN_STATES,
  MANUFACTURING_METHODS,
  MANUFACTURING_PRIORITIES,
} from "../../../lib/manufacturing";
import {
  addPart,
  assignPart,
  bulkAddFromBom,
  computeManufacturingView,
  defaultSeasonYear,
  moveState,
  updatePart,
  type ManufacturingView,
} from "../../../lib/manufacturing/compute-manufacturing";
import type {
  ManufacturingMethod,
  ManufacturingPriority,
  ManufacturingState,
} from "../../../lib/manufacturing/types";

export type { ManufacturingView };

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

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeManufacturingView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Part Manufacturing. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies ManufacturingView,
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

  const orgId = uuidOrNull(body.orgId);
  const action = typeof body.action === "string" ? body.action : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  const userId = session.user.id;

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(
        `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2`,
        [orgId, userId],
      );
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "add-part": {
          const partName = trimmedOrNull(body.partName, 160);
          if (!partName) throw new Error("partName is required");
          await addPart(client, {
            orgId,
            userId,
            partName,
            quantity: positiveInt(body.quantity, 1),
            method: oneOf<ManufacturingMethod>(MANUFACTURING_METHODS, body.method) ?? "other",
            priority: oneOf<ManufacturingPriority>(MANUFACTURING_PRIORITIES, body.priority) ?? "normal",
            seasonYear: positiveInt(body.seasonYear, defaultSeasonYear()),
            subsystemId: uuidOrNull(body.subsystemId),
            bomEntryId: uuidOrNull(body.bomEntryId),
            inventoryItemId: uuidOrNull(body.inventoryItemId),
            buildTaskId: uuidOrNull(body.buildTaskId),
            material: trimmedOrNull(body.material, 200),
            stockNote: trimmedOrNull(body.stockNote, 2000),
            neededBy: isoDateOrNull(body.neededBy),
            reprintOfId: uuidOrNull(body.reprintOfId),
          });
          break;
        }
        case "update-part": {
          const partId = uuidOrNull(body.partId);
          const partName = trimmedOrNull(body.partName, 160);
          if (!partId) throw new Error("partId is required");
          if (!partName) throw new Error("partName is required");
          await updatePart(client, {
            orgId,
            partId,
            partName,
            quantity: positiveInt(body.quantity, 1),
            method: oneOf<ManufacturingMethod>(MANUFACTURING_METHODS, body.method) ?? "other",
            priority: oneOf<ManufacturingPriority>(MANUFACTURING_PRIORITIES, body.priority) ?? "normal",
            subsystemId: uuidOrNull(body.subsystemId),
            material: trimmedOrNull(body.material, 200),
            stockNote: trimmedOrNull(body.stockNote, 2000),
            neededBy: isoDateOrNull(body.neededBy),
          });
          break;
        }
        case "move-state": {
          const partId = uuidOrNull(body.partId);
          const toState = oneOf<ManufacturingState>(KANBAN_STATES, body.toState);
          if (!partId) throw new Error("partId is required");
          if (!toState) throw new Error("toState is required");
          if (toState === "scrapped") throw new Error("Use the scrap action to scrap a part");
          await moveState(client, {
            orgId,
            userId,
            partId,
            toState,
            note: trimmedOrNull(body.note, 2000),
          });
          break;
        }
        case "assign": {
          const partId = uuidOrNull(body.partId);
          if (!partId) throw new Error("partId is required");
          await assignPart(client, { orgId, partId, assignedTo: uuidOrNull(body.assignedTo) });
          break;
        }
        case "scrap": {
          const partId = uuidOrNull(body.partId);
          if (!partId) throw new Error("partId is required");
          const reason = trimmedOrNull(body.reason, 2000);
          await moveState(client, {
            orgId,
            userId,
            partId,
            toState: "scrapped",
            note: reason,
            scrapReason: reason,
          });
          break;
        }
        case "reopen": {
          const partId = uuidOrNull(body.partId);
          const toState = oneOf<ManufacturingState>(KANBAN_STATES, body.toState);
          if (!partId) throw new Error("partId is required");
          if (!toState) throw new Error("toState is required");
          await moveState(client, {
            orgId,
            userId,
            partId,
            toState,
            note: trimmedOrNull(body.note, 2000) ?? "Reopened",
          });
          break;
        }
        case "bulk-add-from-bom": {
          const rawIds = Array.isArray(body.bomEntryIds) ? body.bomEntryIds : [];
          const bomEntryIds = rawIds
            .map((id) => uuidOrNull(id))
            .filter((id): id is string => id != null)
            .slice(0, 100);
          if (bomEntryIds.length === 0) throw new Error("Select at least one BOM entry");
          await bulkAddFromBom(client, {
            orgId,
            userId,
            bomEntryIds,
            subsystemId: uuidOrNull(body.subsystemId),
            seasonYear: positiveInt(body.seasonYear, defaultSeasonYear()),
          });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeManufacturingView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Part Manufacturing request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
