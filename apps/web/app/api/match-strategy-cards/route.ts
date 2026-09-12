import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { failDbWrite } from "../../../lib/db-error";
import {
  computeMatchStrategyCardsView,
  deleteCard,
  upsertCard,
  type MatchStrategyCardsView,
} from "../../../lib/match-strategy-cards/compute-match-strategy-cards";
import type { MatchStrategyRoleAssignment } from "../../../lib/match-strategy-cards/types";

export type { MatchStrategyCardsView };

function trimmedOrNull(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function roleAssignmentsFrom(value: unknown): MatchStrategyRoleAssignment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
    .map((v) => ({
      role: typeof v.role === "string" ? v.role.trim().slice(0, 80) : "",
      assignee: typeof v.assignee === "string" ? v.assignee.trim().slice(0, 80) : "",
    }))
    .filter((r) => r.role || r.assignee)
    .slice(0, 20);
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeMatchStrategyCardsView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Match cards. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace", done: false },
        ],
        orgId: null,
        eventKey: null,
      } satisfies MatchStrategyCardsView,
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

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "save-card": {
          const matchKey = trimmedOrNull(body.matchKey, 64);
          const eventKey = trimmedOrNull(body.eventKey, 64);
          if (!matchKey) throw new Error("matchKey is required");
          if (!eventKey) throw new Error("eventKey is required");
          await upsertCard(client, {
            orgId,
            userId,
            matchKey,
            eventKey,
            gamePlan: trimmedOrNull(body.gamePlan, 4000),
            autoAssignment: trimmedOrNull(body.autoAssignment, 2000),
            defenseFocus: trimmedOrNull(body.defenseFocus, 2000),
            keyThreats: trimmedOrNull(body.keyThreats, 2000),
            driverNotes: trimmedOrNull(body.driverNotes, 4000),
            roleAssignments: roleAssignmentsFrom(body.roleAssignments),
          });
          break;
        }
        case "delete-card": {
          const matchKey = trimmedOrNull(body.matchKey, 64);
          if (!matchKey) throw new Error("matchKey is required");
          await deleteCard(client, { orgId, matchKey });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeMatchStrategyCardsView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    // Rows here are keyed to an event/match that references events_ref, so an
    // event not yet ingested from TBA raised a 23503 whose raw constraint text
    // went straight to the user. failDbWrite names the fix, and keeps the
    // previous behaviour for every other error.
    return failDbWrite(error, "Match cards request failed");
  }
}
