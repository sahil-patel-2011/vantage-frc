import {
  assertOrgCapability,
  auth,
  listOrganizationMembers,
  ORG_CAPABILITIES,
  setMemberCapabilities,
  setMemberRole,
  type OrgCapability,
  type OrgRole,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

const fail = (error: unknown) =>
  Response.json(
    { error: error instanceof Error ? error.message : "Member request failed" },
    { status: 400 },
  );

export async function GET(request: Request) {
  try {
    const current = await session();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");
    const data = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await assertOrgCapability(client, orgId, "manage_members");
      const members = await listOrganizationMembers(client, orgId);
      const actor = await client.query<{ role: OrgRole }>(
        `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2`,
        [orgId, current.user.id],
      );
      return {
        members,
        catalog: ORG_CAPABILITIES,
        actorRole: actor.rows[0]?.role ?? null,
      };
    });
    return Response.json(data);
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as {
      orgId?: string;
      userId?: string;
      action?: "set_capabilities" | "set_role";
      capabilities?: string[];
      role?: OrgRole;
    };
    if (!body.orgId || !body.userId || !body.action) {
      throw new Error("orgId, userId, and action are required");
    }
    const orgId = body.orgId;
    await withRls({ userId: current.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships
         WHERE org_id = $1 AND user_id = $2 AND role IN ('owner','admin')`,
        [orgId, current.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");

      if (body.action === "set_capabilities") {
        const capabilities = (body.capabilities ?? []).filter((value): value is OrgCapability =>
          (ORG_CAPABILITIES as readonly string[]).includes(value),
        );
        await setMemberCapabilities(client, current.user.id, {
          orgId,
          userId: body.userId!,
          capabilities,
        });
        return;
      }
      if (body.action === "set_role") {
        if (!body.role) throw new Error("role is required");
        await setMemberRole(client, current.user.id, {
          orgId,
          userId: body.userId!,
          role: body.role,
        });
        return;
      }
      throw new Error("Invalid member action");
    });
    return Response.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
