import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  SUBTEAMS,
  computeRolesView,
  createRole,
  currentSeasonYear,
  deleteRole,
  updateRole,
  type RolesView,
} from "../../../lib/roles/compute-roles";
import { assertOrgManager, orgRole } from "../../../lib/team-admin/permissions";
import type { Subteam } from "../../../lib/roles/types";

export type { RolesView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 4000): string | null {
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
      computeRolesView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load roles. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
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
      const role = await orgRole(client, orgId, userId);
      if (!role) throw new Error("forbidden");

      switch (action) {
        case "create-role": {
          // Who holds Safety Captain is a mentor decision, not something a viewer assigns
          // themselves. Reading the role map stays open to the whole team.
          assertOrgManager(role, "create a team role");
          const title = trimmedOrNull(body.title, 200);
          if (!title) throw new Error("title is required");
          await createRole(client, {
            orgId,
            userId,
            seasonYear,
            title,
            subteam: oneOf<Subteam>(SUBTEAMS, body.subteam) ?? "other",
            holderUserId: trimmedOrNull(body.holderUserId, 64),
            holderName: trimmedOrNull(body.holderName, 200),
            isLead: body.isLead === true,
            responsibilities: trimmedOrNull(body.responsibilities),
          });
          break;
        }
        case "update-role": {
          assertOrgManager(role, "change a team role");
          const roleId = trimmedOrNull(body.roleId, 64);
          if (!roleId) throw new Error("roleId is required");
          const subteam = body.subteam === undefined ? undefined : oneOf<Subteam>(SUBTEAMS, body.subteam);
          if (body.subteam !== undefined && !subteam) throw new Error("Invalid subteam");
          await updateRole(client, {
            orgId,
            roleId,
            title: body.title === undefined ? undefined : (trimmedOrNull(body.title, 200) ?? undefined),
            subteam: subteam ?? undefined,
            holderUserId:
              body.holderUserId === undefined ? undefined : trimmedOrNull(body.holderUserId, 64),
            holderName: body.holderName === undefined ? undefined : trimmedOrNull(body.holderName, 200),
            isLead: body.isLead === undefined ? undefined : body.isLead === true,
            responsibilities: body.responsibilities === undefined ? undefined : trimmedOrNull(body.responsibilities),
            notes: body.notes === undefined ? undefined : trimmedOrNull(body.notes),
          });
          break;
        }
        case "delete-role": {
          assertOrgManager(role, "delete a team role");
          const roleId = trimmedOrNull(body.roleId, 64);
          if (!roleId) throw new Error("roleId is required");
          await deleteRole(client, { orgId, roleId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeRolesView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Roles request failed";
    const status =
      message === "forbidden" || message.startsWith("Only an owner or admin can") ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
