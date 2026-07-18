import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { HEAT_DIRECTIONS } from "../../../lib/scouting-heat-signals";
import {
  computeScoutingHeatSignalsView,
  deleteHeatSignalEntry,
  logHeatSignalEntry,
  type ScoutingHeatSignalsView,
} from "../../../lib/scouting-heat-signals/compute-scouting-heat-signals";
import type { HeatDirection } from "../../../lib/scouting-heat-signals/types";

export type { ScoutingHeatSignalsView };

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

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positiveIntOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeScoutingHeatSignalsView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Scouting Heat Signals. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
      } satisfies ScoutingHeatSignalsView,
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
        case "log-entry": {
          const teamNumber = positiveIntOrNull(body.teamNumber);
          const observedOn = isoDateOrNull(body.observedOn);
          const direction = oneOf<HeatDirection>(HEAT_DIRECTIONS, body.direction);
          if (!teamNumber) throw new Error("teamNumber is required");
          if (!observedOn) throw new Error("observedOn (YYYY-MM-DD) is required");
          if (!direction) throw new Error("direction is required");
          const result = await logHeatSignalEntry(client, {
            orgId,
            userId,
            teamNumber,
            observedOn,
            direction,
            metricValue: body.metricValue == null || body.metricValue === "" ? null : numberOrNull(body.metricValue),
            note: trimmedOrNull(body.note, 2000),
            matchKey: trimmedOrNull(body.matchKey, 64),
          });
          if (!result.ok) throw new Error(result.error);
          break;
        }
        case "delete-entry": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!entryId) throw new Error("entryId is required");
          await deleteHeatSignalEntry(client, { orgId, entryId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeScoutingHeatSignalsView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scouting Heat Signals request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
