import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  EQUIPMENT_CATEGORIES,
  MAINTENANCE_ACTIONS,
  computeEquipmentMaintenanceView,
  createAsset,
  deleteAsset,
  deleteLog,
  logMaintenance,
  setAssetActive,
  type EquipmentMaintenanceView,
} from "../../../lib/equipment-maintenance/compute-equipment-maintenance";
import type { EquipmentCategory, MaintenanceAction } from "../../../lib/equipment-maintenance/types";

export type { EquipmentMaintenanceView };

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

function positiveIntOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function nonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeEquipmentMaintenanceView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Equipment Maintenance. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies EquipmentMaintenanceView,
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
        case "create-asset": {
          const name = trimmedOrNull(body.name, 200);
          if (!name) throw new Error("name is required");
          const category = oneOf<EquipmentCategory>(EQUIPMENT_CATEGORIES, body.category) ?? "other";
          await createAsset(client, {
            orgId,
            userId,
            name,
            category,
            location: trimmedOrNull(body.location, 200),
            intervalDays: positiveIntOrNull(body.intervalDays),
            notes: trimmedOrNull(body.notes, 4000),
          });
          break;
        }
        case "set-asset-active": {
          const assetId = trimmedOrNull(body.assetId, 64);
          if (!assetId) throw new Error("assetId is required");
          await setAssetActive(client, { orgId, assetId, active: Boolean(body.active) });
          break;
        }
        case "delete-asset": {
          const assetId = trimmedOrNull(body.assetId, 64);
          if (!assetId) throw new Error("assetId is required");
          await deleteAsset(client, { orgId, assetId });
          break;
        }
        case "log-maintenance": {
          const assetId = trimmedOrNull(body.assetId, 64);
          const performedOn = isoDateOrNull(body.performedOn);
          if (!assetId) throw new Error("assetId is required");
          if (!performedOn) throw new Error("performedOn (YYYY-MM-DD) is required");
          const maintenanceAction = oneOf<MaintenanceAction>(MAINTENANCE_ACTIONS, body.maintenanceAction) ?? "routine";
          await logMaintenance(client, {
            orgId,
            userId,
            assetId,
            performedOn,
            action: maintenanceAction,
            minutesSpent: nonNegativeInt(body.minutesSpent),
            notes: trimmedOrNull(body.notes, 4000),
          });
          break;
        }
        case "delete-log": {
          const logId = trimmedOrNull(body.logId, 64);
          if (!logId) throw new Error("logId is required");
          await deleteLog(client, { orgId, logId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeEquipmentMaintenanceView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Equipment Maintenance request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
