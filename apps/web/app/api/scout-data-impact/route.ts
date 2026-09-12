import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { isScoutForbidden, scoutForbiddenResponse } from "../../../lib/scout-org-access";
import { headers } from "next/headers";
import {
  acknowledgeImpact,
  computeScoutDataImpactView,
  deletePick,
  logPick,
  type ScoutDataImpactView,
} from "../../../lib/scout-data-impact/compute-scout-data-impact";

export type { ScoutDataImpactView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function teamKeyFrom(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return /^frc\d+$/.test(trimmed) ? trimmed : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const eventKey = url.searchParams.get("eventKey");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeScoutDataImpactView(client, { userId: session.user.id, requestedOrg, eventKey }),
    );
    return Response.json(view);
  } catch (error) {
    if (isScoutForbidden(error)) return scoutForbiddenResponse();
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Scout Data Impact. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        eventKey: null,
      } satisfies ScoutDataImpactView,
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
  const eventKey = trimmedOrNull(body.eventKey, 64);

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "log-pick": {
          if (!eventKey) throw new Error("eventKey is required");
          const teamKey = teamKeyFrom(body.teamKey);
          if (!teamKey) throw new Error("teamKey (e.g. frc254) is required");
          const allianceNumber = positiveInt(body.allianceNumber, 1);
          const pickOrder = positiveInt(body.pickOrder, 1);
          await logPick(client, {
            orgId,
            userId,
            eventKey,
            teamKey,
            allianceNumber: Math.min(8, allianceNumber),
            pickOrder,
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "delete-pick": {
          const pickId = trimmedOrNull(body.pickId, 64);
          if (!pickId) throw new Error("pickId is required");
          await deletePick(client, { orgId, pickId });
          break;
        }
        case "acknowledge": {
          if (!eventKey) throw new Error("eventKey is required");
          await acknowledgeImpact(client, { orgId, userId, eventKey });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeScoutDataImpactView(client, { userId, requestedOrg: orgId, eventKey });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scout Data Impact request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
