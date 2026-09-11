import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  LEADERSHIP_CATEGORY_VALUES,
  LEADERSHIP_STATUS_VALUES,
  computeLeadershipView,
  createRole,
  currentSeasonYear,
  deleteRole,
  updateHandoffStatus,
  type LeadershipView,
} from "../../../lib/leadership/compute-leadership";
import type { LeadershipCategory, LeadershipHandoffStatus } from "../../../lib/leadership/types";

export type { LeadershipView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
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
      computeLeadershipView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Leadership. Choose your team and try again.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose your team to open Leadership.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies LeadershipView,
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
        case "create-role": {
          const roleTitle = trimmedOrNull(body.roleTitle, 200);
          const holderName = trimmedOrNull(body.holderName, 200);
          if (!roleTitle) throw new Error("roleTitle is required");
          if (!holderName) throw new Error("holderName is required");
          const category = oneOf<LeadershipCategory>(LEADERSHIP_CATEGORY_VALUES, body.category) ?? "leadership";
          const handoffStatus =
            oneOf<LeadershipHandoffStatus>(LEADERSHIP_STATUS_VALUES, body.handoffStatus) ?? "not_started";
          await createRole(client, {
            orgId,
            userId,
            roleTitle,
            category,
            holderName,
            successorName: trimmedOrNull(body.successorName, 200),
            handoffStatus,
            targetHandoffDate: isoDateOrNull(body.targetHandoffDate),
            notes: trimmedOrNull(body.notes, 4000),
            seasonYear,
          });
          break;
        }
        case "update-status": {
          const roleId = trimmedOrNull(body.roleId, 64);
          if (!roleId) throw new Error("roleId is required");
          const handoffStatus = oneOf<LeadershipHandoffStatus>(LEADERSHIP_STATUS_VALUES, body.handoffStatus);
          if (!handoffStatus) throw new Error("handoffStatus is invalid");
          await updateHandoffStatus(client, {
            orgId,
            roleId,
            handoffStatus,
            successorName: trimmedOrNull(body.successorName, 200),
          });
          break;
        }
        case "delete-role": {
          const roleId = trimmedOrNull(body.roleId, 64);
          if (!roleId) throw new Error("roleId is required");
          await deleteRole(client, { orgId, roleId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeLeadershipView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Leadership Continuity request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
