import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  addWatchlistTeam,
  computeEpaTrendAlertsView,
  dismissAlert,
  removeWatchlistTeam,
  type EpaTrendAlertsView,
} from "../../../lib/epa-trend-alerts/compute-epa-trend-alerts";

export type { EpaTrendAlertsView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function teamNumberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n) : null;
}

const SETUP_REQUIRED_FALLBACK: EpaTrendAlertsView = {
  status: "setup_required",
  message: "Could not load Rating alerts. Choose your team and confirm database access.",
  steps: [
    { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
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
      computeEpaTrendAlertsView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(SETUP_REQUIRED_FALLBACK, { status: 200 });
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
        case "watch-team": {
          const teamNumber = teamNumberOrNull(body.teamNumber);
          if (!teamNumber) throw new Error("teamNumber is required");
          const result = await addWatchlistTeam(client, {
            orgId,
            userId,
            teamNumber,
            note: trimmedOrNull(body.note, 500),
          });
          if (!result.ok) throw new Error(result.error);
          break;
        }
        case "unwatch-team": {
          const watchlistId = trimmedOrNull(body.watchlistId, 64);
          if (!watchlistId) throw new Error("watchlistId is required");
          await removeWatchlistTeam(client, { orgId, watchlistId });
          break;
        }
        case "dismiss-alert": {
          const teamKey = trimmedOrNull(body.teamKey, 32);
          const latestEventKey = trimmedOrNull(body.latestEventKey, 64);
          if (!teamKey) throw new Error("teamKey is required");
          if (!latestEventKey) throw new Error("latestEventKey is required");
          await dismissAlert(client, { orgId, userId, teamKey, latestEventKey });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeEpaTrendAlertsView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rating alerts request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
