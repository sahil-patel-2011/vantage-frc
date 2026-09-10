import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  AUTON_PATH_RUN_OUTCOMES,
  AUTON_PATH_START_POSITIONS,
  currentSeasonYear,
} from "../../../lib/auton-path-library";
import {
  computeAutonPathLibraryView,
  createPath,
  deletePath,
  deleteRun,
  logRun,
  setPathActive,
  type AutonPathLibraryView,
} from "../../../lib/auton-path-library/compute-auton-path-library";
import type { AutonPathRunOutcome, AutonPathStartPosition } from "../../../lib/auton-path-library/types";

export type { AutonPathLibraryView };

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

function nonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
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
      computeAutonPathLibraryView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the Autonomous Path Library. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies AutonPathLibraryView,
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
        case "create-path": {
          const name = trimmedOrNull(body.name, 200);
          if (!name) throw new Error("name is required");
          const startPosition =
            oneOf<AutonPathStartPosition>(AUTON_PATH_START_POSITIONS, body.startPosition) ?? "other";
          await createPath(client, {
            orgId,
            userId,
            name,
            startPosition,
            description: trimmedOrNull(body.description, 4000),
            gamePieces: nonNegativeInt(body.gamePieces),
            seasonYear,
          });
          break;
        }
        case "set-path-active": {
          const pathId = trimmedOrNull(body.pathId, 64);
          if (!pathId) throw new Error("pathId is required");
          await setPathActive(client, { orgId, pathId, active: Boolean(body.active) });
          break;
        }
        case "delete-path": {
          const pathId = trimmedOrNull(body.pathId, 64);
          if (!pathId) throw new Error("pathId is required");
          await deletePath(client, { orgId, pathId });
          break;
        }
        case "log-run": {
          const pathId = trimmedOrNull(body.pathId, 64);
          const occurredOn = isoDateOrNull(body.occurredOn);
          if (!pathId) throw new Error("pathId is required");
          if (!occurredOn) throw new Error("occurredOn (YYYY-MM-DD) is required");
          const outcome = oneOf<AutonPathRunOutcome>(AUTON_PATH_RUN_OUTCOMES, body.outcome) ?? "success";
          await logRun(client, {
            orgId,
            userId,
            pathId,
            outcome,
            occurredOn,
            eventLabel: trimmedOrNull(body.eventLabel, 200),
            matchLabel: trimmedOrNull(body.matchLabel, 100),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "delete-run": {
          const runId = trimmedOrNull(body.runId, 64);
          if (!runId) throw new Error("runId is required");
          await deleteRun(client, { orgId, runId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeAutonPathLibraryView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Autonomous Path Library request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
