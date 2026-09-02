import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  SUBTEAMS,
  computeRoleHolders,
  computeRolesView,
  createRole,
  currentSeasonYear,
  deleteRole,
  updateRole,
  type RoleHoldersView,
  type RolesView,
} from "../../../lib/roles/compute-roles";
import type { Subteam } from "../../../lib/roles/types";

export type { RoleHoldersView, RolesView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function uuidOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed) ? trimmed : null;
}

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonParam = url.searchParams.get("season");
  const seasonYear = seasonParam ? seasonFrom(seasonParam) : null;
  const resolve = url.searchParams.get("resolve") === "1";

  try {
    if (resolve) {
      const holders = await withRls({ userId: session.user.id }, (client) =>
        computeRoleHolders(client, { userId: session.user.id, requestedOrg, seasonYear }),
      );
      return Response.json(holders);
    }
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeRolesView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    if (resolve) {
      return Response.json(
        { status: "setup_required", orgId: null, seasonYear: seasonYear ?? currentSeasonYear(), holders: [] } satisfies RoleHoldersView,
        { status: 200 },
      );
    }
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load roles. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies RolesView,
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
      const member = await client.query<{ role: string }>(
        `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
        [orgId, userId],
      );
      if (!member.rowCount) throw new HttpError(403, "Organization access denied");
      const role = member.rows[0]!.role;
      if (role !== "owner" && role !== "admin") {
        throw new HttpError(403, "Only an owner or admin can change roles. Ask a mentor to update who holds this role.");
      }

      switch (action) {
        case "create-role": {
          const title = trimmedOrNull(body.title, 200);
          if (!title) throw new HttpError(400, "title is required");
          const holderUserId = body.holderUserId === undefined || body.holderUserId === "" ? null : uuidOrNull(body.holderUserId);
          if (body.holderUserId && !holderUserId) throw new HttpError(400, "Invalid holder");
          await createRole(client, {
            orgId,
            userId,
            seasonYear,
            title,
            subteam: oneOf<Subteam>(SUBTEAMS, body.subteam) ?? "other",
            holderUserId,
            holderName: trimmedOrNull(body.holderName, 200),
            isLead: body.isLead === true,
            responsibilities: trimmedOrNull(body.responsibilities),
          });
          break;
        }
        case "update-role": {
          const roleId = trimmedOrNull(body.roleId, 64);
          if (!roleId) throw new HttpError(400, "roleId is required");
          const subteam = body.subteam === undefined ? undefined : oneOf<Subteam>(SUBTEAMS, body.subteam);
          if (body.subteam !== undefined && !subteam) throw new HttpError(400, "Invalid subteam");
          let holderUserId: string | null | undefined;
          if (body.holderUserId !== undefined) {
            holderUserId = body.holderUserId === null || body.holderUserId === "" ? null : uuidOrNull(body.holderUserId);
            if (body.holderUserId && !holderUserId) throw new HttpError(400, "Invalid holder");
          }
          await updateRole(client, {
            orgId,
            roleId,
            title: body.title === undefined ? undefined : (trimmedOrNull(body.title, 200) ?? undefined),
            subteam: subteam ?? undefined,
            holderUserId,
            holderName: body.holderName === undefined ? undefined : trimmedOrNull(body.holderName, 200),
            isLead: body.isLead === undefined ? undefined : body.isLead === true,
            responsibilities: body.responsibilities === undefined ? undefined : trimmedOrNull(body.responsibilities),
            notes: body.notes === undefined ? undefined : trimmedOrNull(body.notes),
          });
          break;
        }
        case "delete-role": {
          const roleId = trimmedOrNull(body.roleId, 64);
          if (!roleId) throw new HttpError(400, "roleId is required");
          await deleteRole(client, { orgId, roleId });
          break;
        }
        default:
          throw new HttpError(400, "Unknown action");
      }

      return computeRolesView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Roles request failed";
    return Response.json({ error: message }, { status });
  }
}
