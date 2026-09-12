import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { isScoutForbidden, scoutForbiddenResponse } from "../../../lib/scout-org-access";
import { headers } from "next/headers";
import {
  acknowledgeCoverageNudge,
  computeScoutCoverageLiveView,
  sendCoverageNudge,
  setThinThreshold,
  type ScoutCoverageLiveView,
} from "../../../lib/scout-coverage-live/compute-scout-coverage-live";

export type { ScoutCoverageLiveView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
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
  const requestedEvent = url.searchParams.get("eventKey");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeScoutCoverageLiveView(client, { userId: session.user.id, requestedOrg, requestedEvent }),
    );
    return Response.json(view);
  } catch (error) {
    if (isScoutForbidden(error)) return scoutForbiddenResponse();
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load live scouting coverage. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        eventKey: null,
      } satisfies ScoutCoverageLiveView,
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
  const requestedEvent = trimmedOrNull(body.eventKey, 64);

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "set-threshold": {
          const thinThreshold = positiveIntOrNull(body.thinThreshold);
          if (!thinThreshold) throw new Error("thinThreshold must be a positive integer");
          await setThinThreshold(client, { orgId, userId, thinThreshold });
          break;
        }
        case "send-nudge": {
          const eventKey = trimmedOrNull(body.eventKey, 64);
          const matchKey = trimmedOrNull(body.matchKey, 64);
          const teamKey = trimmedOrNull(body.teamKey, 32);
          const message = trimmedOrNull(body.message, 500);
          if (!eventKey) throw new Error("eventKey is required");
          if (!matchKey) throw new Error("matchKey is required");
          if (!teamKey) throw new Error("teamKey is required");
          if (!message) throw new Error("message is required");
          await sendCoverageNudge(client, { orgId, userId, eventKey, matchKey, teamKey, message });
          break;
        }
        case "acknowledge-nudge": {
          const nudgeId = trimmedOrNull(body.nudgeId, 64);
          if (!nudgeId) throw new Error("nudgeId is required");
          await acknowledgeCoverageNudge(client, { orgId, userId, nudgeId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeScoutCoverageLiveView(client, { userId, requestedOrg: orgId, requestedEvent });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scout coverage live request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
