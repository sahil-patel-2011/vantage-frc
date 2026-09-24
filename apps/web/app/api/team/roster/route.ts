import { withRls } from "@vantage/db";
import { publicErrorMessage } from "../../../../lib/security/public-error";
import { TenantHttpError, requireOrgMember, requireTenantSession } from "../../../../lib/tenant-org-access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_ORDER = "CASE m.role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'scout' THEN 2 ELSE 3 END";

export type RosterMember = { userId: string; name: string; role: string; joinedAt: string; you: boolean };

/**
 * GET /api/team/roster?orgId=… — any member: who is on the team, by name and role.
 *
 * The People tab used to show only attendance, and the member list lived on Team admin
 * where only owners could see it. Names come from the same sources the rest of the app
 * uses (display name, then account name, then the part of the email before the @); emails
 * are not returned, so a scout sees names, not addresses. Row-level security limits this
 * to the caller's own team.
 */
export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    const orgId = new URL(request.url).searchParams.get("orgId") ?? "";
    if (!UUID.test(orgId)) throw new TenantHttpError(400, "Choose a team first.");
    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const me = await requireOrgMember(client, orgId, session.user.id);
      const rows = await client.query<{ userId: string; name: string | null; role: string; joinedAt: string }>(
        `SELECT m.user_id::text AS "userId",
                COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(u.name), ''),
                         NULLIF(split_part(u.email, '@', 1), '')) AS name,
                m.role::text AS role,
                m.created_at::text AS "joinedAt"
           FROM memberships m
           JOIN users u ON u.id = m.user_id
           LEFT JOIN profiles p ON p.user_id = m.user_id
          WHERE m.org_id = $1::uuid
          ORDER BY ${ROLE_ORDER}, lower(COALESCE(p.display_name, u.name, u.email)) ASC
          LIMIT 500`,
        [orgId],
      );
      return { canManage: me.admin, members: rows.rows };
    });
    const members: RosterMember[] = data.members.map((row) => ({
      userId: row.userId,
      name: row.name ?? "Team member",
      role: row.role,
      joinedAt: row.joinedAt,
      you: row.userId === session.user.id,
    }));
    return Response.json({ canManage: data.canManage, members }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const status = error instanceof TenantHttpError ? error.status : 500;
    return Response.json(
      { error: publicErrorMessage(error, "Couldn't load the team list. Try again.") },
      { status, headers: { "cache-control": "private, no-store" } },
    );
  }
}
