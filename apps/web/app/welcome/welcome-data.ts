import { listMemberHubAccess } from "@vantage/core";
import { withRls } from "@vantage/db";
import type { ClientHubAccessRow } from "../../lib/nav/hub-access-filter";

export type WelcomeTeam = { orgId: string; orgName: string | null; teamNumber: number | null; role: string };

export type WelcomeData = {
  firstName: string | null;
  platformAdmin: boolean;
  teams: WelcomeTeam[];
  /** The team this page is about, or null when the person is not on the one asked for. */
  active: (WelcomeTeam & { capabilities: string[]; hubAccess: ClientHubAccessRow[]; sponsorsAllowed: boolean | null }) | null;
};

/**
 * Everything /welcome shows, read as the signed-in person (their own rows only). Owners and
 * mentors open every section, so their hub rows are not read, matching /api/me.
 */
export async function loadWelcome(userId: string, fallbackName: string | null, orgId: string | null): Promise<WelcomeData> {
  return withRls({ userId, ...(orgId ? { orgId } : {}) }, async (client) => {
    const self = await client.query<{ platformAdmin: boolean; firstName: string | null; displayName: string | null }>(
      `SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id=$1::uuid) AS "platformAdmin",
              p.first_name AS "firstName", p.display_name AS "displayName"
       FROM (SELECT 1) AS one
       LEFT JOIN profiles p ON p.user_id=$1::uuid`,
      [userId],
    );
    const teams = await client.query<WelcomeTeam>(
      `SELECT m.org_id::text AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role::text AS role
       FROM memberships m
       JOIN organizations o ON o.id = m.org_id
       WHERE m.user_id=$1
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number NULLS LAST, o.name`,
      [userId],
    );
    const team = (orgId ? teams.rows.find((row) => row.orgId === orgId) : teams.rows[0]) ?? null;
    let active: WelcomeData["active"] = null;
    if (team) {
      const capabilities = await client.query<{ capability: string }>(
        `SELECT capability::text AS capability FROM membership_capabilities WHERE org_id=$1 AND user_id=$2`,
        [team.orgId, userId],
      );
      const funding = await client.query<{ sponsorsAllowed: boolean | null }>(
        `SELECT sponsors_allowed AS "sponsorsAllowed" FROM organizations WHERE id=$1::uuid`,
        [team.orgId],
      );
      const hubAccess =
        team.role === "owner" || team.role === "admin" ? [] : await listMemberHubAccess(client, team.orgId, userId);
      active = {
        ...team,
        capabilities: capabilities.rows.map((row) => row.capability),
        hubAccess: hubAccess as ClientHubAccessRow[],
        sponsorsAllowed: funding.rows[0]?.sponsorsAllowed ?? null,
      };
    }
    const row = self.rows[0];
    const name = row?.firstName?.trim() || (row?.displayName?.trim() || fallbackName?.trim() || "").split(" ")[0] || null;
    return { firstName: name, platformAdmin: Boolean(row?.platformAdmin), teams: teams.rows, active };
  });
}
