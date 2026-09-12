import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { isScoutForbidden, scoutForbiddenResponse } from "../../../lib/scout-org-access";
import { headers } from "next/headers";
import {
  computeScoutP2pRelayView,
  currentSeasonYear,
  deleteSession,
  logEntry,
  startSession,
  updateSessionStatus,
  type ScoutP2pRelayView,
} from "../../../lib/scout-p2p-relay/compute-scout-p2p-relay";
import type { RelayDeviceRole, RelaySessionStatus } from "../../../lib/scout-p2p-relay/types";

export type { ScoutP2pRelayView };

const DEVICE_ROLES: RelayDeviceRole[] = ["scout", "captain"];
const SESSION_STATUSES: RelaySessionStatus[] = ["open", "synced", "closed"];

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 200): string | null {
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
      computeScoutP2pRelayView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch (error) {
    if (isScoutForbidden(error)) return scoutForbiddenResponse();
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Pit mesh. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies ScoutP2pRelayView,
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
        case "start-session": {
          const eventKey = trimmedOrNull(body.eventKey, 40);
          const captainDeviceLabel = trimmedOrNull(body.captainDeviceLabel, 120);
          if (!eventKey) throw new Error("eventKey is required");
          if (!captainDeviceLabel) throw new Error("captainDeviceLabel is required");
          await startSession(client, { orgId, userId, eventKey, captainDeviceLabel, seasonYear });
          break;
        }
        case "log-entry": {
          const sessionId = trimmedOrNull(body.sessionId, 64);
          const deviceLabel = trimmedOrNull(body.deviceLabel, 120);
          if (!sessionId) throw new Error("sessionId is required");
          if (!deviceLabel) throw new Error("deviceLabel is required");
          const deviceRole = oneOf<RelayDeviceRole>(DEVICE_ROLES, body.deviceRole) ?? "scout";
          await logEntry(client, {
            orgId,
            userId,
            sessionId,
            deviceLabel,
            deviceRole,
            entriesContributed: nonNegativeInt(body.entriesContributed),
            conflictsResolved: nonNegativeInt(body.conflictsResolved),
            uplinked: Boolean(body.uplinked),
          });
          break;
        }
        case "update-status": {
          const sessionId = trimmedOrNull(body.sessionId, 64);
          const status = oneOf<RelaySessionStatus>(SESSION_STATUSES, body.status);
          if (!sessionId) throw new Error("sessionId is required");
          if (!status) throw new Error("status is invalid");
          await updateSessionStatus(client, { orgId, sessionId, status });
          break;
        }
        case "delete-session": {
          const sessionId = trimmedOrNull(body.sessionId, 64);
          if (!sessionId) throw new Error("sessionId is required");
          await deleteSession(client, { orgId, sessionId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeScoutP2pRelayView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pit mesh request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
