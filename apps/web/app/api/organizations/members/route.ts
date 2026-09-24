import {
  assertOrgCapability,
  auth,
  getAdminTenureSnapshot,
  HUB_ACCESS_HUB_IDS,
  listOrganizationMembers,
  listOrgHubAccessByUser,
  ORG_CAPABILITIES,
  setMemberCapabilities,
  setMemberHubAccess,
  removeMember,
  setMemberRole,
  type HubAccessHubId,
  type MemberHubAccessRow,
  type OrgCapability,
  type OrgRole,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { publicErrorMessage } from "../../../../lib/security/public-error";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

const fail = (error: unknown) =>
  Response.json(
    { error: publicErrorMessage(error, "Member request failed") },
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
      // One set-based read for every member's hub allowlist (was one query per member).
      const hubAccessByUser: Record<string, MemberHubAccessRow[]> = await listOrgHubAccessByUser(
        client,
        orgId,
        members.map((member) => member.userId),
      );
      const adminTenure = await getAdminTenureSnapshot(client, orgId);
      return {
        members,
        catalog: ORG_CAPABILITIES,
        hubCatalog: HUB_ACCESS_HUB_IDS,
        hubAccessByUser,
        actorRole: actor.rows[0]?.role ?? null,
        actorUserId: current.user.id,
        adminTenure,
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
      action?: "set_capabilities" | "set_role" | "set_hub_access" | "remove";
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
      if (body.action === "remove") {
        await removeMember(client, current.user.id, { orgId, userId: body.userId! });
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
