import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computeFieldResetTimerView,
  createSession,
  currentSeasonYear,
  deleteCycle,
  deleteSession,
  logCycle,
  type FieldResetTimerView,
} from "../../../lib/field-reset-timer/compute-field-reset-timer";

export type { FieldResetTimerView };

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function positiveInt(value: unknown, fallback = 1): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
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
      computeFieldResetTimerView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Field Reset Timer. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies FieldResetTimerView,
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
        case "create-session": {
          const label = trimmedOrNull(body.label, 200);
          const occurredOn = isoDateOrNull(body.occurredOn);
          if (!label) throw new Error("label is required");
          if (!occurredOn) throw new Error("occurredOn (YYYY-MM-DD) is required");
          await createSession(client, {
            orgId,
            userId,
            label,
            occurredOn,
            seasonYear,
            notes: trimmedOrNull(body.notes, 4000),
          });
          break;
        }
        case "delete-session": {
          const sessionId = trimmedOrNull(body.sessionId, 64);
          if (!sessionId) throw new Error("sessionId is required");
          await deleteSession(client, { orgId, sessionId });
          break;
        }
        case "log-cycle": {
          const sessionId = trimmedOrNull(body.sessionId, 64);
          const resetSeconds = nonNegativeNumber(body.resetSeconds);
          if (!sessionId) throw new Error("sessionId is required");
          if (resetSeconds == null) throw new Error("resetSeconds is required");
          await logCycle(client, {
            orgId,
            userId,
            sessionId,
            cycleNumber: positiveInt(body.cycleNumber, 1),
            resetSeconds,
            cycleSeconds: nonNegativeNumber(body.cycleSeconds),
            note: trimmedOrNull(body.note, 2000),
          });
          break;
        }
        case "delete-cycle": {
          const cycleId = trimmedOrNull(body.cycleId, 64);
          if (!cycleId) throw new Error("cycleId is required");
          await deleteCycle(client, { orgId, cycleId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeFieldResetTimerView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Field Reset Timer request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
