import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { isTeamId } from "../../../../lib/nav/remembered-team";
import { LifecycleError, sessionIsFresh } from "../../../../lib/team-lifecycle/model";
import { forgetRememberedTeam, lifecycleErrorResponse } from "../../../../lib/team-lifecycle/respond";
import {
  deleteTeam,
  leaveTeam,
  listTeamLifecycle,
  loadTeamLifecycle,
  renameTeam,
} from "../../../../lib/team-lifecycle/store";

/**
 * A team's lifecycle, for the person asking: rename it (owner or team admin), leave it (anyone but
 * the last owner) and delete it (the owner). Migration 0720 holds the rules; the routes say why.
 */

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = (await request.json().catch(() => null)) as unknown;
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

function teamIdFrom(value: unknown): string {
  if (typeof value !== "string" || !isTeamId(value.trim())) throw new LifecycleError("not_a_member");
  return value.trim();
}

const NO_STORE = { "cache-control": "private, no-store" };

/** Your teams and what you may do to each; `?orgId=` for one. */
export async function GET(request: Request) {
  try {
    const current = await session();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (orgId) {
      const id = teamIdFrom(orgId);
      const team = await withRls({ userId: current.user.id, orgId: id }, (client) =>
        loadTeamLifecycle(client, current.user.id, id),
      );
      if (!team) throw new LifecycleError("not_a_member");
      return Response.json({ team }, { headers: NO_STORE });
    }
    const teams = await withRls({ userId: current.user.id }, (client) => listTeamLifecycle(client, current.user.id));
    return Response.json({ teams }, { headers: NO_STORE });
  } catch (error) {
    return lifecycleErrorResponse(error, "rename");
  }
}

/** Rename the team. */
export async function PATCH(request: Request) {
  try {
    const current = await session();
    const body = await readBody(request);
    const orgId = teamIdFrom(body.orgId);
    const name = await withRls({ userId: current.user.id, orgId }, (client) =>
      renameTeam(client, current.user.id, orgId, body.name),
    );
    return Response.json({ name }, { headers: NO_STORE });
  } catch (error) {
    return lifecycleErrorResponse(error, "rename");
  }
}

/** Leave the team: `{ orgId, action: "leave" }`. */
export async function POST(request: Request) {
  try {
    const current = await session();
    const body = await readBody(request);
    if (body.action !== "leave") return Response.json({ error: "Choose what to do with the team." }, { status: 400 });
    const orgId = teamIdFrom(body.orgId);
    await withRls({ userId: current.user.id, orgId }, (client) => leaveTeam(client, orgId));
    const response = Response.json({ left: true, next: "/account/teams" }, { headers: NO_STORE });
    forgetRememberedTeam(response.headers);
    return response;
  } catch (error) {
    return lifecycleErrorResponse(error, "leave");
  }
}

/** Delete the team for everyone: `{ orgId, confirm }`, where confirm is the typed team number. */
export async function DELETE(request: Request) {
  try {
    const current = await session();
    const body = await readBody(request);
    const orgId = teamIdFrom(body.orgId);
    const confirm = typeof body.confirm === "string" ? body.confirm : "";
    if (!sessionIsFresh(current.session.createdAt)) throw new LifecycleError("reauth_required");
    await withRls({ userId: current.user.id, orgId }, (client) => deleteTeam(client, orgId, confirm));
    const response = Response.json({ deleted: true, next: "/account/teams" }, { headers: NO_STORE });
    forgetRememberedTeam(response.headers);
    return response;
  } catch (error) {
    return lifecycleErrorResponse(error, "delete_team");
  }
}
