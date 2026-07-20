import {
  assertOrgCapability,
  auth,
  HUB_ACCESS_HUB_IDS,
  listMemberHubAccess,
  listOrganizationMembers,
  ORG_CAPABILITIES,
  setMemberCapabilities,
  setMemberHubAccess,
  setMemberRole,
  type HubAccessHubId,
  type MemberHubAccessRow,
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
      const hubAccessByUser: Record<string, MemberHubAccessRow[]> = {};
      for (const member of members) {
        hubAccessByUser[member.userId] = await listMemberHubAccess(client, orgId, member.userId);
      }
      return {
        members,
        catalog: ORG_CAPABILITIES,
        hubCatalog: HUB_ACCESS_HUB_IDS,
        hubAccessByUser,
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
      action?: "set_capabilities" | "set_role" | "set_hub_access";
      capabilities?: string[];
      role?: OrgRole;
      hubAccess?: Array<{ hubId: string; allowedTabIds?: string[] }>;
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
      if (body.action === "set_hub_access") {
        const access: MemberHubAccessRow[] = (body.hubAccess ?? [])
          .filter((entry): entry is { hubId: HubAccessHubId; allowedTabIds?: string[] } =>
            (HUB_ACCESS_HUB_IDS as readonly string[]).includes(entry.hubId),
          )
          .map((entry) => ({
            hubId: entry.hubId,
            allowedTabIds: entry.allowedTabIds ?? [],
          }));
        await setMemberHubAccess(client, current.user.id, {
          orgId,
          userId: body.userId!,
          access,
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
