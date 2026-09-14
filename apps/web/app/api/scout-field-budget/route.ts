import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { isScoutForbidden, scoutForbiddenResponse } from "../../../lib/scout-org-access";
import { headers } from "next/headers";
import {
  computeScoutFieldBudgetView,
  deleteSnapshot,
  logSnapshot,
  type ScoutFieldBudgetView,
} from "../../../lib/scout-field-budget/compute-scout-field-budget";

export type { ScoutFieldBudgetView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function nonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeScoutFieldBudgetView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch (error) {
    if (isScoutForbidden(error)) return scoutForbiddenResponse();
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the field-count budget linter. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies ScoutFieldBudgetView,
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
        case "log-snapshot": {
          const schemaName = trimmedOrNull(body.schemaName, 200);
          if (!schemaName) throw new Error("schemaName is required");
          await logSnapshot(client, {
            orgId,
            userId,
            schemaName,
            autoFields: nonNegativeInt(body.autoFields),
            teleopFields: nonNegativeInt(body.teleopFields),
            endgameFields: nonNegativeInt(body.endgameFields),
            pitFields: nonNegativeInt(body.pitFields),
            postMatchFields: nonNegativeInt(body.postMatchFields),
            notes: trimmedOrNull(body.notes, 4000),
          });
          break;
        }
        case "delete-snapshot": {
          const snapshotId = trimmedOrNull(body.snapshotId, 64);
          if (!snapshotId) throw new Error("snapshotId is required");
          await deleteSnapshot(client, { orgId, snapshotId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeScoutFieldBudgetView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Field-count budget request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
