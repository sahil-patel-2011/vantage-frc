import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { TUNING_CONTROLLER_TYPES } from "../../../lib/tuning-autopilot";
import {
  computeTuningAutopilotView,
  createSession,
  currentSeasonYear,
  deleteIteration,
  deleteSession,
  logIteration,
  updateSessionStatus,
  type TuningAutopilotView,
} from "../../../lib/tuning-autopilot/compute-tuning-autopilot";
import type { TuningControllerType, TuningGains, TuningSessionStatus } from "../../../lib/tuning-autopilot/types";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

export type { TuningAutopilotView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function nonNegativeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function anyNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseGains(value: unknown): TuningGains {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    kP: anyNumber(row.kP),
    kI: anyNumber(row.kI),
    kD: anyNumber(row.kD),
    kS: anyNumber(row.kS),
    kV: anyNumber(row.kV),
    kG: anyNumber(row.kG),
  };
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonParam = url.searchParams.get("season");
  const seasonYear = seasonParam ? seasonFrom(seasonParam) : null;
  const sessionId = url.searchParams.get("sessionId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeTuningAutopilotView(client, {
        userId: session.user.id,
        requestedOrg,
        seasonYear,
        sessionId,
      }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the tuning autopilot. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies TuningAutopilotView,
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

      let selectedSessionId = trimmedOrNull(body.sessionId, 64);

      switch (action) {
        case "create-session": {
          const subsystem = trimmedOrNull(body.subsystem, 200);
          if (!subsystem) throw new Error("subsystem is required");
          const controllerType = oneOf<TuningControllerType>(TUNING_CONTROLLER_TYPES, body.controllerType) ?? "pid";
          selectedSessionId = await createSession(client, {
            orgId,
            userId,
            seasonYear,
            subsystem,
            controllerType,
            goal: trimmedOrNull(body.goal, 500) ?? "",
          });
          break;
        }
        case "update-session-status": {
          const sessionId = trimmedOrNull(body.sessionId, 64);
          const status = oneOf<TuningSessionStatus>(["active", "converged", "abandoned"], body.status);
          if (!sessionId) throw new Error("sessionId is required");
          if (!status) throw new Error("status is invalid");
          await updateSessionStatus(client, { orgId, sessionId, status });
          break;
        }
        case "delete-session": {
          const sessionId = trimmedOrNull(body.sessionId, 64);
          if (!sessionId) throw new Error("sessionId is required");
          await deleteSession(client, { orgId, sessionId });
          if (selectedSessionId === sessionId) selectedSessionId = null;
          break;
        }
        case "log-iteration": {
          const sessionId = trimmedOrNull(body.sessionId, 64);
          if (!sessionId) throw new Error("sessionId is required");
          const gains = parseGains(body.gains);
          await logIteration(client, {
            orgId,
            userId,
            sessionId,
            gains,
            result: {
              overshootPct: nonNegativeNumber(body.overshootPct),
              settlingTimeSec: nonNegativeNumber(body.settlingTimeSec),
              steadyStateError: nonNegativeNumber(body.steadyStateError),
              oscillating: Boolean(body.oscillating),
            },
            notes: trimmedOrNull(body.notes, 2000) ?? "",
          });
          selectedSessionId = sessionId;
          break;
        }
        case "delete-iteration": {
          const iterationId = trimmedOrNull(body.iterationId, 64);
          if (!iterationId) throw new Error("iterationId is required");
          await deleteIteration(client, { orgId, iterationId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeTuningAutopilotView(client, {
        userId,
        requestedOrg: orgId,
        seasonYear,
        sessionId: selectedSessionId,
      });
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Tuning autopilot request failed");
  }
}
