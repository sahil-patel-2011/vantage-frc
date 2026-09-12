import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  CHECKLIST_STATUSES,
  computeSpareRobotKitView,
  currentSeasonYear,
  deleteChecklist,
  generateChecklist,
  togglePacked,
  updateChecklistStatus,
  type SpareRobotKitView,
} from "../../../lib/spare-robot-kit/compute-spare-robot-kit";
import type { ChecklistStatus } from "../../../lib/spare-robot-kit/types";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

export type { SpareRobotKitView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

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
      computeSpareRobotKitView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the spare-robot-kit checklist. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies SpareRobotKitView,
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
        case "generate-checklist": {
          const title = trimmedOrNull(body.title, 200) ?? `Spare robot kit — ${seasonYear}`;
          await generateChecklist(client, { orgId, userId, seasonYear, title });
          break;
        }
        case "toggle-packed": {
          const checklistId = trimmedOrNull(body.checklistId, 64);
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!checklistId) throw new Error("checklistId is required");
          if (!itemId) throw new Error("itemId is required");
          await togglePacked(client, { orgId, checklistId, itemId });
          break;
        }
        case "update-status": {
          const checklistId = trimmedOrNull(body.checklistId, 64);
          const status = oneOf<ChecklistStatus>(CHECKLIST_STATUSES, body.status);
          if (!checklistId) throw new Error("checklistId is required");
          if (!status) throw new Error("status is invalid");
          await updateChecklistStatus(client, { orgId, checklistId, status });
          break;
        }
        case "delete-checklist": {
          const checklistId = trimmedOrNull(body.checklistId, 64);
          if (!checklistId) throw new Error("checklistId is required");
          await deleteChecklist(client, { orgId, checklistId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeSpareRobotKitView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Spare-robot-kit request failed");
  }
}
