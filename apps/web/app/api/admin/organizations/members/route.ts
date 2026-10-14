import {
  assertPlatformAdmin,
  assertPlatformPrivilegeMfa,
  auth,
  platformAdminDeniedResponse,
  roleChangedNotice,
  teamDisplayName,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

/**
 * Platform admin → Teams → a team → Members and permissions. The platform owner reads and sets
 * each person's access on any team, through platform_owner_team_members() and
 * platform_owner_set_member_access() (0736), which refuse everyone but the platform owner.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

type MemberRow = {
  userId: string;
  name: string;
  email: string;
  role: string;
  capabilities: string[];
  hubAccess: Array<{ hubId: string; allowedTabIds: string[] }>;
};

export async function GET(request: Request) {
  try {
    const current = await session();
    const orgId = new URL(request.url).searchParams.get("orgId")?.trim() ?? "";
    if (!UUID.test(orgId)) return Response.json({ error: "Pick a team." }, { status: 400 });
    const data = await withRls({ userId: current.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      const team = await client.query<{ id: string; name: string; teamNumber: number | null }>(
        `SELECT id, name, team_number AS "teamNumber" FROM organizations WHERE id = $1::uuid`,
        [orgId],
      );
      if (!team.rows[0]) return null;
      const members = await client.query<MemberRow>(
        `SELECT member_id AS "userId", member_name AS name, member_email AS email, member_role::text AS role,
                capabilities, hub_access AS "hubAccess"
           FROM platform_owner_team_members($1::uuid)`,
        [orgId],
      );
      return { team: team.rows[0], members: members.rows, actorUserId: current.user.id };
    });
    if (!data) return Response.json({ error: "That team is not on Vantage any more." }, { status: 404 });
    return Response.json(data);
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const current = await session();
    const body = (await request.json().catch(() => ({}))) as {
      orgId?: unknown;
      userId?: unknown;
      role?: unknown;
      capabilities?: unknown;
      hubAccess?: unknown;
    };
    const orgId = typeof body.orgId === "string" ? body.orgId.trim() : "";
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const role = typeof body.role === "string" ? body.role : "";
    if (!UUID.test(orgId) || !UUID.test(userId)) {
      return Response.json({ error: "Pick a person on a team." }, { status: 400 });
    }
    if (!["admin", "scout", "viewer"].includes(role)) {
      return Response.json({ error: "Choose Mentor or coach, Student, or Parent or guest." }, { status: 400 });
    }
    const capabilities = Array.isArray(body.capabilities)
      ? body.capabilities.filter((value): value is string => typeof value === "string")
      : [];
    const hubAccess = Array.isArray(body.hubAccess) ? body.hubAccess : [];

    await withRls({ userId: current.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      await assertPlatformPrivilegeMfa(client, { userId: current.user.id, sessionId: current.session.id });
      // Worded like Team admin's notice; the function only sends it when the role really changes.
      const facts = await client.query<{ name: string; teamNumber: number | null; previousRole: string | null }>(
        `SELECT o.name, o.team_number AS "teamNumber",
                (SELECT m.role::text FROM memberships m WHERE m.org_id = o.id AND m.user_id = $2::uuid) AS "previousRole"
           FROM organizations o WHERE o.id = $1::uuid`,
        [orgId, userId],
      );
      const row = facts.rows[0];
      const notice = row
        ? roleChangedNotice({
            orgId,
            team: teamDisplayName(row.teamNumber, row.name),
            actorName: "The Vantage platform owner",
            role,
            previousRole: row.previousRole,
          }).payload
        : null;
      await client.query(
        `SELECT platform_owner_set_member_access($1::uuid, $2::uuid, $3::org_role, $4::text[], $5::jsonb, $6::jsonb)`,
        [orgId, userId, role, capabilities, JSON.stringify(hubAccess), notice ? JSON.stringify(notice) : null],
      );
    });
    return Response.json({ success: true });
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}
