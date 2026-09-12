import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { failMeteredAi } from "../../../lib/metered-ai-fail";
import {
  computePicklistJustifierView,
  generatePicklistJustifications,
  type PicklistJustifierView,
} from "../../../lib/picklist-justifier/compute-picklist-justifier";

export type { PicklistJustifierView };

function trimmedOrNull(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const pickListId = url.searchParams.get("pickListId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computePicklistJustifierView(client, { userId: session.user.id, requestedOrg, pickListId }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the pick-list justifier. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies PicklistJustifierView,
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
        case "generate": {
          const pickListId = trimmedOrNull(body.pickListId, 64);
          if (!pickListId) throw new Error("pickListId is required");
          return generatePicklistJustifications(client, { orgId, userId, pickListId });
        }
        case "select-picklist": {
          const pickListId = trimmedOrNull(body.pickListId, 64);
          return computePicklistJustifierView(client, { userId, requestedOrg: orgId, pickListId });
        }
        default:
          throw new Error("Unknown action");
      }
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Pick-list justifier request failed");
  }
}
