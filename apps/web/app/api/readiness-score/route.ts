import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { failMeteredAi } from "../../../lib/metered-ai-fail";
import {
  addChecklistItem,
  computeReadinessScoreView,
  currentSeasonYear,
  deleteChecklistItem,
  deleteSubsystem,
  isCodeVersionStatus,
  isWiringStatus,
  saveSubsystem,
  toggleChecklistItem,
  type ReadinessScoreView,
} from "../../../lib/readiness-score/compute-readiness-score";

export type { ReadinessScoreView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function nonNegativeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
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
      computeReadinessScoreView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Readiness Score. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies ReadinessScoreView,
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
        case "save-subsystem": {
          const name = trimmedOrNull(body.name, 120);
          if (!name) throw new Error("name is required");
          const wiringStatus = isWiringStatus(body.wiringStatus) ? body.wiringStatus : "not_started";
          const codeVersionStatus = isCodeVersionStatus(body.codeVersionStatus)
            ? body.codeVersionStatus
            : "stale";
          await saveSubsystem(client, {
            orgId,
            userId,
            seasonYear,
            name,
            weightLbs: nonNegativeNumber(body.weightLbs),
            powerDrawAmps: nonNegativeNumber(body.powerDrawAmps),
            wiringStatus,
            codeVersionStatus,
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "delete-subsystem": {
          const subsystemId = trimmedOrNull(body.subsystemId, 64);
          if (!subsystemId) throw new Error("subsystemId is required");
          await deleteSubsystem(client, { orgId, subsystemId });
          break;
        }
        case "add-checklist-item": {
          const label = trimmedOrNull(body.label, 300);
          if (!label) throw new Error("label is required");
          await addChecklistItem(client, {
            orgId,
            userId,
            seasonYear,
            label,
            subsystemName: trimmedOrNull(body.subsystemName, 120),
            sequence: Math.max(0, Math.round(Number(body.sequence) || 0)),
          });
          break;
        }
        case "toggle-checklist-item": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          await toggleChecklistItem(client, { orgId, itemId, isComplete: Boolean(body.isComplete) });
          break;
        }
        case "delete-checklist-item": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          await deleteChecklistItem(client, { orgId, itemId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeReadinessScoreView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Readiness Score request failed");
  }
}
