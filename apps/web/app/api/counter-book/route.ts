import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { failMeteredAi } from "../../../lib/metered-ai-fail";
import {
  computeCounterBookView,
  deleteCounterBookReport,
  generateCounterBookReport,
  type CounterBookView,
} from "../../../lib/counter-book/compute-counter-book";

export type { CounterBookView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeCounterBookView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load counter-books. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies CounterBookView,
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
        case "generate-report": {
          const teamKey = trimmedOrNull(body.teamKey, 32);
          if (!teamKey) throw new Error("teamKey is required");
          const eventKey = trimmedOrNull(body.eventKey, 32);
          await generateCounterBookReport(client, { orgId, userId, teamKey, eventKey });
          break;
        }
        case "delete-report": {
          const reportId = trimmedOrNull(body.reportId, 64);
          if (!reportId) throw new Error("reportId is required");
          await deleteCounterBookReport(client, { orgId, reportId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeCounterBookView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Counter-book request failed");
  }
}
