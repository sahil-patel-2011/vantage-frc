import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  addWatchlistEntry,
  computeOpponentWatchlistView,
  removeWatchlistEntry,
  type OpponentWatchlistView,
} from "../../../lib/opponent-watchlist/compute-opponent-watchlist";

export type { OpponentWatchlistView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function teamKeyOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return /^frc\d+$/.test(trimmed) ? trimmed : null;
}

function teamNumberFromKey(teamKey: string): number | null {
  const match = teamKey.match(/^frc(\d+)$/);
  return match ? Number(match[1]) : null;
}

function boolOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

const SETUP_REQUIRED: OpponentWatchlistView = {
  status: "setup_required",
  message: "Could not load your opponent watchlist. Select a team and confirm database access.",
  steps: [
    { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
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
      computeOpponentWatchlistView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(SETUP_REQUIRED, { status: 200 });
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
        case "add-entry": {
          const teamKey = teamKeyOrNull(body.teamKey);
          if (!teamKey) throw new Error("teamKey (e.g. frc254) is required");
          await addWatchlistEntry(client, {
            orgId,
            userId,
            teamKey,
            teamNumber: teamNumberFromKey(teamKey),
            note: trimmedOrNull(body.note, 500),
            notifySchedule: boolOrDefault(body.notifySchedule, true),
            notifyEpa: boolOrDefault(body.notifyEpa, true),
          });
          break;
        }
        case "remove-entry": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!entryId) throw new Error("entryId is required");
          await removeWatchlistEntry(client, { orgId, userId, entryId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeOpponentWatchlistView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Opponent watchlist request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
