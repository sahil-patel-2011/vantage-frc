import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computeAlliancePartnerBriefView,
  generateAlliancePartnerBrief,
  type AlliancePartnerBriefView,
} from "../../../lib/alliance-partner-brief/compute-alliance-partner-brief";

export type { AlliancePartnerBriefView };

function trimmedOrNull(value: unknown, max = 200): string | null {
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
  const eventKey = trimmedOrNull(url.searchParams.get("eventKey"), 64);
  const allianceSeed = positiveIntOrNull(url.searchParams.get("allianceSeed"));

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeAlliancePartnerBriefView(client, {
        userId: session.user.id,
        requestedOrg,
        eventKey,
        allianceSeed,
      }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the alliance-partner brief. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
          {
            id: "alliance-board",
            label: "Run alliance selection",
            detail: "Build and finalize picks on an alliance board",
            href: "/strategy/draft",
          },
        ],
        orgId: null,
        eventKey: eventKey ?? null,
      } satisfies AlliancePartnerBriefView,
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
        case "generate-brief": {
          const eventKey = trimmedOrNull(body.eventKey, 64);
          const allianceSeed = positiveIntOrNull(body.allianceSeed);
          if (!allianceSeed) throw new Error("allianceSeed is required");
          return generateAlliancePartnerBrief(client, { orgId, userId, eventKey, allianceSeed });
        }
        default:
          throw new Error("Unknown action");
      }
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Alliance-partner brief request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
