import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  DEFAULT_WEIGHT_LIMIT_LBS,
  ROBOT_WEIGH_IN_STATIONS,
  computeRobotWeighInView,
  currentSeasonYear,
  deleteWeighIn,
  logWeighIn,
  resolveConfiguredLimit,
  type RobotWeighInView,
} from "../../../lib/robot-weigh-in/compute-robot-weigh-in";
import type { RobotWeighInStation } from "../../../lib/robot-weigh-in/types";

export type { RobotWeighInView };

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

function positiveWeight(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : fallback;
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
      computeRobotWeighInView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Robot Weigh-In. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies RobotWeighInView,
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
        case "log-weigh-in": {
          const weighedOn = isoDateOrNull(body.weighedOn);
          if (!weighedOn) throw new Error("weighedOn (YYYY-MM-DD) is required");
          const weightLbs = positiveWeight(body.weightLbs, NaN);
          if (!Number.isFinite(weightLbs)) throw new Error("weightLbs is required");
          const station = oneOf<RobotWeighInStation>(ROBOT_WEIGH_IN_STATIONS, body.station) ?? "shop";
          // Ground the default limit in the org's configured weight-budget limit before the FRC default.
          const configuredLimit = await resolveConfiguredLimit(client, orgId, seasonYear);
          await logWeighIn(client, {
            orgId,
            userId,
            weighedOn,
            weightLbs,
            weightLimitLbs: positiveWeight(body.weightLimitLbs, configuredLimit ?? DEFAULT_WEIGHT_LIMIT_LBS),
            station,
            bumpersOn: body.bumpersOn !== false,
            batteryOn: body.batteryOn !== false,
            seasonYear,
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "delete-weigh-in": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!entryId) throw new Error("entryId is required");
          await deleteWeighIn(client, { orgId, entryId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeRobotWeighInView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Robot Weigh-In request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
