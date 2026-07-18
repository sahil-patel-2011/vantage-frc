import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { failMeteredAi } from "../../../lib/metered-ai-fail";
import {
  computeInspectionCopilotView,
  currentSeasonYear,
  deleteCheck,
  logCheck,
  parseFrameBumper,
  parseWeightBudget,
  parseWiringPower,
  type InspectionCopilotView,
} from "../../../lib/inspection-copilot/compute-inspection-copilot";

export type { InspectionCopilotView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonParam = url.searchParams.get("season");
  const seasonYear = seasonParam ? seasonFrom(seasonParam) : null;

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeInspectionCopilotView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the inspection copilot. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies InspectionCopilotView,
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
  const seasonYear = seasonFrom(body.seasonYear);

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "log-check": {
          const robotName = trimmedOrNull(body.robotName, 200);
          if (!robotName) throw new Error("robotName is required");
          const weightBudget = parseWeightBudget(body.weightBudget);
          const frameBumper = parseFrameBumper(body.frameBumper);
          const wiringPower = parseWiringPower(body.wiringPower);
          if (weightBudget.items.length === 0) {
            throw new Error("At least one weight-budget item is required");
          }
          await logCheck(client, {
            orgId,
            userId,
            seasonYear,
            robotName,
            weightBudget,
            frameBumper,
            wiringPower,
          });
          break;
        }
        case "delete-check": {
          const checkId = trimmedOrNull(body.checkId, 64);
          if (!checkId) throw new Error("checkId is required");
          await deleteCheck(client, { orgId, checkId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeInspectionCopilotView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Inspection copilot request failed");
  }
}
