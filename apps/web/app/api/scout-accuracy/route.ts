import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { isScoutForbidden, scoutForbiddenResponse } from "../../../lib/scout-org-access";
import { headers } from "next/headers";
import {
  computeScoutAccuracyView,
  currentSeasonYear,
  recordScoutAccuracySnapshot,
  setScoutAccuracyPromotion,
  type ScoutAccuracyView,
} from "../../../lib/scout-accuracy/compute-scout-accuracy";
import { scoutAccuracySetupSteps } from "../../../lib/scout-accuracy/scout-accuracy-related";

export type { ScoutAccuracyView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
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
  const eventKey = url.searchParams.get("eventKey");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeScoutAccuracyView(client, { userId: session.user.id, requestedOrg, eventKey }),
    );
    return Response.json(view);
  } catch (error) {
    if (isScoutForbidden(error)) return scoutForbiddenResponse();
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load scout accuracy. Select a workspace and confirm database access.",
        steps: scoutAccuracySetupSteps(null),
        orgId: null,
      } satisfies ScoutAccuracyView,
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
        case "record-snapshot": {
          const eventKey = trimmedOrNull(body.eventKey, 64);
          if (!eventKey) throw new Error("eventKey is required");
          return recordScoutAccuracySnapshot(client, { orgId, userId, eventKey, seasonYear });
        }
        case "set-promotion": {
          const eventKey = trimmedOrNull(body.eventKey, 64);
          const scoutUserId = trimmedOrNull(body.scoutUserId, 64);
          if (!eventKey) throw new Error("eventKey is required");
          if (!scoutUserId) throw new Error("scoutUserId is required");
          const promoted = body.promoted !== false;
          const note = trimmedOrNull(body.note, 500);
          return setScoutAccuracyPromotion(client, { orgId, userId, eventKey, scoutUserId, promoted, note });
        }
        default:
          throw new Error("Unknown action");
      }
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scout accuracy request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
