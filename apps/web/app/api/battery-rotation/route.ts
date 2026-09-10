import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  BATTERY_STATUSES,
  addBattery,
  computeBatteryRotationView,
  deleteAssignment,
  deleteBattery,
  logReading,
  scheduleAssignment,
  updateBatteryStatus,
  type BatteryRotationView,
} from "../../../lib/battery-rotation/compute-battery-rotation";
import type { BatteryStatus } from "../../../lib/battery-rotation/types";

export type { BatteryRotationView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nonNegativeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function nonNegativeIntOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeBatteryRotationView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load battery rotation. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies BatteryRotationView,
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
        case "add-battery": {
          const label = trimmedOrNull(body.label, 120);
          if (!label) throw new Error("label is required");
          const status = oneOf<BatteryStatus>(BATTERY_STATUSES, body.status) ?? "active";
          await addBattery(client, {
            orgId,
            userId,
            label,
            serialNumber: trimmedOrNull(body.serialNumber, 120),
            status,
            purchasedOn: /^\d{4}-\d{2}-\d{2}$/.test(String(body.purchasedOn ?? "")) ? (body.purchasedOn as string) : null,
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "update-status": {
          const batteryId = trimmedOrNull(body.batteryId, 64);
          const status = oneOf<BatteryStatus>(BATTERY_STATUSES, body.status);
          if (!batteryId) throw new Error("batteryId is required");
          if (!status) throw new Error("A valid status is required");
          await updateBatteryStatus(client, { orgId, batteryId, status });
          break;
        }
        case "delete-battery": {
          const batteryId = trimmedOrNull(body.batteryId, 64);
          if (!batteryId) throw new Error("batteryId is required");
          await deleteBattery(client, { orgId, batteryId });
          break;
        }
        case "log-reading": {
          const batteryId = trimmedOrNull(body.batteryId, 64);
          const internalResistanceMohm = Number(body.internalResistanceMohm);
          if (!batteryId) throw new Error("batteryId is required");
          if (!Number.isFinite(internalResistanceMohm) || internalResistanceMohm < 0) {
            throw new Error("internalResistanceMohm must be a non-negative number");
          }
          await logReading(client, {
            orgId,
            userId,
            batteryId,
            recordedAt: isoOrNull(body.recordedAt),
            internalResistanceMohm,
            voltage: body.voltage != null && body.voltage !== "" ? nonNegativeNumber(body.voltage) : null,
            cycleCount: nonNegativeIntOrNull(body.cycleCount),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "schedule-assignment": {
          const batteryId = trimmedOrNull(body.batteryId, 64);
          const matchLabel = trimmedOrNull(body.matchLabel, 120);
          const scheduledAt = isoOrNull(body.scheduledAt);
          if (!batteryId) throw new Error("batteryId is required");
          if (!matchLabel) throw new Error("matchLabel is required");
          if (!scheduledAt) throw new Error("scheduledAt is required");
          await scheduleAssignment(client, {
            orgId,
            userId,
            batteryId,
            matchLabel,
            scheduledAt,
            chargeMinutesAvailable: nonNegativeInt(body.chargeMinutesAvailable),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "delete-assignment": {
          const assignmentId = trimmedOrNull(body.assignmentId, 64);
          if (!assignmentId) throw new Error("assignmentId is required");
          await deleteAssignment(client, { orgId, assignmentId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeBatteryRotationView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Battery rotation request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}

function nonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}
