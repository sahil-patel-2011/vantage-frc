import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  DRIVETRAIN_TYPES,
  computeDefensePlannerView,
  currentSeasonYear,
  deleteMatchup,
  logMatchup,
  upsertRobotProfile,
  type DefensePlannerView,
} from "../../../lib/defense-planner/compute-defense-planner";
import type { DrivetrainType } from "../../../lib/defense-planner/types";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

export type { DefensePlannerView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function trimmedOrEmpty(value: unknown, max = 2000): string {
  return trimmedOrNull(value, max) ?? "";
}

function positiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function positiveIntOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
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
      computeDefensePlannerView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the defense planner. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies DefensePlannerView,
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
        case "save-robot-profile": {
          const massLbs = positiveNumber(body.massLbs);
          if (!massLbs) throw new Error("massLbs must be a positive number");
          const drivetrain = oneOf<DrivetrainType>(DRIVETRAIN_TYPES, body.drivetrain) ?? "west_coast";
          await upsertRobotProfile(client, {
            orgId,
            userId,
            seasonYear,
            massLbs,
            drivetrain,
            topSpeedFps: positiveNumber(body.topSpeedFps),
            notes: trimmedOrEmpty(body.notes, 2000),
          });
          break;
        }
        case "log-matchup": {
          const opponentTeamNumber = positiveIntOrNull(body.opponentTeamNumber);
          if (!opponentTeamNumber) throw new Error("opponentTeamNumber is required");
          const opponentMassLbs = positiveNumber(body.opponentMassLbs);
          if (!opponentMassLbs) throw new Error("opponentMassLbs must be a positive number");
          const opponentCycleTimeSec = positiveNumber(body.opponentCycleTimeSec);
          if (!opponentCycleTimeSec) throw new Error("opponentCycleTimeSec must be a positive number");
          const opponentAvgPointsPerCycle = nonNegativeNumber(body.opponentAvgPointsPerCycle);
          if (opponentAvgPointsPerCycle == null) throw new Error("opponentAvgPointsPerCycle must be a number");
          const opponentDrivetrain = oneOf<DrivetrainType>(DRIVETRAIN_TYPES, body.opponentDrivetrain) ?? "west_coast";

          const view = await computeDefensePlannerView(client, { userId, requestedOrg: orgId, seasonYear });
          const robotProfile = view.status === "live" ? view.robotProfile : null;

          await logMatchup(client, {
            orgId,
            userId,
            seasonYear,
            opponentTeamNumber,
            opponentTeamName: trimmedOrEmpty(body.opponentTeamName, 200),
            eventKey: trimmedOrNull(body.eventKey, 64),
            opponentMassLbs,
            opponentDrivetrain,
            opponentCycleTimeSec,
            opponentCyclePath: trimmedOrEmpty(body.opponentCyclePath, 2000),
            opponentAvgPointsPerCycle,
            notes: trimmedOrEmpty(body.notes, 2000),
            robotProfile,
          });
          break;
        }
        case "delete-matchup": {
          const matchupId = trimmedOrNull(body.matchupId, 64);
          if (!matchupId) throw new Error("matchupId is required");
          await deleteMatchup(client, { orgId, matchupId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeDefensePlannerView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Defense request failed");
  }
}
