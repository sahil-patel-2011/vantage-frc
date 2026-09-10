import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  addBattery,
  computeBatteryHealthForecastView,
  deleteBattery,
  logReading,
  reactivateBattery,
  retireBattery,
  type BatteryHealthForecastView,
} from "../../../lib/battery-health-forecast/compute-battery-health-forecast";

export type { BatteryHealthForecastView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function isoTimestampOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function nonNegativeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const SETUP_FALLBACK: BatteryHealthForecastView = {
  status: "setup_required",
  message: "Could not load Battery Health Forecast. Select a team and confirm database access.",
  steps: [
    { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
  ],
  orgId: null,
};

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeBatteryHealthForecastView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(SETUP_FALLBACK, { status: 200 });
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
          const label = trimmedOrNull(body.label, 200);
          if (!label) throw new Error("label is required");
          await addBattery(client, {
            orgId,
            userId,
            label,
            serialNumber: trimmedOrNull(body.serialNumber, 100),
            putInServiceOn: isoDateOrNull(body.putInServiceOn),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "log-reading": {
          const batteryId = trimmedOrNull(body.batteryId, 64);
          const internalResistanceMohm = numberOrNull(body.internalResistanceMohm);
          if (!batteryId) throw new Error("batteryId is required");
          if (internalResistanceMohm == null) throw new Error("internalResistanceMohm is required");
          await logReading(client, {
            orgId,
            userId,
            batteryId,
            recordedAt: isoTimestampOrNull(body.recordedAt),
            cycleCount: nonNegativeNumber(body.cycleCount),
            internalResistanceMohm,
            voltage: numberOrNull(body.voltage),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "retire-battery": {
          const batteryId = trimmedOrNull(body.batteryId, 64);
          if (!batteryId) throw new Error("batteryId is required");
          await retireBattery(client, { orgId, batteryId, retiredOn: isoDateOrNull(body.retiredOn) });
          break;
        }
        case "reactivate-battery": {
          const batteryId = trimmedOrNull(body.batteryId, 64);
          if (!batteryId) throw new Error("batteryId is required");
          await reactivateBattery(client, { orgId, batteryId });
          break;
        }
        case "delete-battery": {
          const batteryId = trimmedOrNull(body.batteryId, 64);
          if (!batteryId) throw new Error("batteryId is required");
          await deleteBattery(client, { orgId, batteryId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeBatteryHealthForecastView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Battery Health Forecast request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
