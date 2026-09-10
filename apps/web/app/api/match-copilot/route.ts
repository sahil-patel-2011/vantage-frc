import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computeMatchCopilotView,
  generateMatchCopilotBrief,
} from "../../../lib/match-copilot/compute-match-copilot";
import type { MatchCopilotView } from "../../../lib/match-copilot/types";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

export type { MatchCopilotView };

function trimmedOrNull(value: unknown, max = 64): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

const SETUP_FALLBACK: MatchCopilotView = {
  status: "setup_required",
  message: "Could not load Match Copilot. Select a team and confirm database access.",
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
      computeMatchCopilotView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(SETUP_FALLBACK, { status: 200 });
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
        case "generate-brief":
          return generateMatchCopilotBrief(client, { userId, requestedOrg: orgId });
        default:
          throw new Error("Unknown action");
      }
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Match Copilot request failed");
  }
}
