import {
  applyRoleProfile,
  auth,
  deleteRoleProfile,
  ensureStarterRoleProfiles,
  listRoleProfiles,
  saveRoleProfile,
  type OrgRole,
  type RoleProfileBaseRole,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

/**
 * Role profiles for one org. Reads are open to members (a student may see what a
 * Team lead is allowed to do); writes and applies require owner/admin, which the
 * table's RLS policy enforces a second time underneath these checks.
 */

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

const fail = (error: unknown) =>
  Response.json(
    { error: error instanceof Error ? error.message : "Role profile request failed" },
    { status: 400 },
  );

export async function GET(request: Request) {
  try {
    const current = await session();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");
    const data = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const actor = await client.query<{ role: OrgRole }>(
        `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2`,
        [orgId, current.user.id],
      );
      const actorRole = actor.rows[0]?.role ?? null;
      if (!actorRole) throw new Error("Organization membership required");
      if (actorRole === "owner" || actorRole === "admin") {
        await ensureStarterRoleProfiles(client, orgId, current.user.id);
      }
      return { profiles: await listRoleProfiles(client, orgId), actorRole };
    });
    return Response.json(data);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as {
      orgId?: string;
      action?: "save" | "delete" | "apply";
      key?: string;
      name?: string;
      description?: string;
      baseRole?: RoleProfileBaseRole;
      capabilities?: string[];
      hubAccess?: Record<string, string[]>;
      userId?: string;
    };
    if (!body.orgId || !body.action) throw new Error("orgId and action are required");
    const orgId = body.orgId;
    const result = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2 AND role IN ('owner','admin')`,
        [orgId, current.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");

      if (body.action === "save") {
        if (!body.name || !body.baseRole) throw new Error("name and baseRole are required");
        return {
          profile: await saveRoleProfile(client, current.user.id, orgId, {
            key: body.key ?? body.name,
            name: body.name,
            description: body.description,
            baseRole: body.baseRole,
            capabilities: body.capabilities,
            hubAccess: body.hubAccess,
          }),
        };
      }
      if (body.action === "delete") {
        if (!body.key) throw new Error("key is required");
        await deleteRoleProfile(client, orgId, body.key);
        return { deleted: body.key };
      }
      if (body.action === "apply") {
        if (!body.key || !body.userId) throw new Error("key and userId are required");
        return {
          applied: await applyRoleProfile(client, current.user.id, {
            orgId,
            userId: body.userId,
            key: body.key,
          }),
        };
      }
      throw new Error("Invalid role profile action");
    });
    return Response.json({ success: true, ...result });
  } catch (error) {
    return fail(error);
  }
}
