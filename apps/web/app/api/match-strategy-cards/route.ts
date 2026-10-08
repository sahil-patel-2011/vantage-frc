import { auth } from "@vantage/core";
import type { PoolClient } from "@neondatabase/serverless";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { failDbWrite } from "../../../lib/db-error";
import { IntelHttpError, withIntelRequest } from "../../../lib/intel-auth";
import {
  computeMatchStrategyCardsView,
  deleteCard,
  upsertCard,
  MatchCardConflictError,
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
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const work = (client: PoolClient) => computeMatchStrategyCardsView(client, { userId: session.user.id, requestedOrg });
    const resolvedOrg = requestedOrg || await withRls({ userId: session.user.id }, async client => (
      await client.query<{ orgId: string }>(`SELECT m.org_id AS "orgId" FROM memberships m JOIN organizations o ON o.id=m.org_id
        WHERE m.user_id=$1 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number LIMIT 1`, [session.user.id])
    ).rows[0]?.orgId ?? null);
    const view = resolvedOrg ? await withIntelRequest(resolvedOrg, client => computeMatchStrategyCardsView(client, { userId: session.user.id, requestedOrg: resolvedOrg })) : await withRls({ userId: session.user.id }, work);
    return Response.json(view, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof IntelHttpError ? error.message : "Could not load match plans. Try again." }, { status: error instanceof IntelHttpError ? error.status : 503, headers: { "cache-control": "private, no-store" } });
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgId = trimmedOrNull(body.orgId, 64);
  const action = typeof body.action === "string" ? body.action : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
  if (Object.hasOwn(body, "baseRevision") && body.baseRevision !== null &&
    (typeof body.baseRevision !== "string" || !Number.isFinite(Date.parse(body.baseRevision)))) {
    return Response.json({ error: "Invalid saved-plan revision. Reload the plan before editing." }, { status: 400 });
  }
  const revision = Object.hasOwn(body, "baseRevision") ? { baseRevision: body.baseRevision as string | null } : {};

  const userId = session.user.id;

  try {
    const view = await withIntelRequest(orgId, async (client) => {
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
            ...revision,
          });
          break;
        }
        case "delete-card": {
          const matchKey = trimmedOrNull(body.matchKey, 64);
          if (!matchKey) throw new Error("matchKey is required");
          await deleteCard(client, { orgId, matchKey, ...revision });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeMatchStrategyCardsView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    if (error instanceof IntelHttpError || error instanceof MatchCardConflictError) {
      return Response.json({ error: error.message }, { status: error instanceof IntelHttpError ? error.status : 409 });
    }
    // Rows here are keyed to an event/match that references events_ref, so an
    // event not yet ingested from TBA raised a 23503 whose raw constraint text
    // went straight to the user. failDbWrite names the fix, and keeps the
    // previous behaviour for every other error.
    return failDbWrite(error, "Match Strategy Cards request failed");
  }
}
