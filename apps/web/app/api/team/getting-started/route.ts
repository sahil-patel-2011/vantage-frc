import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

// Team transition/onboarding checklist. Aggregates the real state of a team
// so a team moving in can see, at a glance, what is set up and what is left:
// members invited, subteam calendar, knowledge wiki, logistics, kickoff summary,
// AI budgets, assistant tried, alumni/Discord. Admin-only signals are gated.

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!session || !orgId) {
      return Response.json({ error: "Authentication and organization are required" }, { status: 401 });
    }
    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const membership = await client.query<{
        role: string;
        teamNumber: number | null;
        orgName: string;
        city: string | null;
        stateProv: string | null;
      }>(
        `SELECT m.role, o.team_number AS "teamNumber", o.name AS "orgName",
                o.city, o.state_prov AS "stateProv"
         FROM memberships m JOIN organizations o ON o.id = m.org_id
         WHERE m.org_id=$1 AND m.user_id=$2`,
        [orgId, session.user.id],
      );
      if (!membership.rowCount) throw new Error("Organization access denied");
      const role = membership.rows[0]!.role;
      const isAdmin = ["owner", "admin"].includes(role);

      const count = async (sql: string) =>
        Number((await client.query<{ c: string }>(sql, [orgId])).rows[0]?.c ?? 0);

      const [
        members,
        pendingInvites,
        knowledgeLen,
        memoriesCount,
        alumniCount,
        runsCount,
        mySubteams,
        logisticsTrips,
        kickoffActions,
      ] = await Promise.all([
        count(`SELECT count(*) AS c FROM memberships WHERE org_id=$1`),
        count(`SELECT count(*) AS c FROM invites WHERE org_id=$1 AND status='pending'`),
        count(`SELECT COALESCE(length(btrim(content)),0) AS c FROM team_knowledge WHERE org_id=$1`),
        count(`SELECT count(*) AS c FROM team_memories WHERE org_id=$1`),
        count(`SELECT count(*) AS c FROM team_alumni WHERE org_id=$1`),
        count(`SELECT count(*) AS c FROM ai_runs WHERE org_id=$1`),
        client
          .query<{ c: string }>(
            `SELECT count(*) AS c FROM team_subteam_members WHERE org_id=$1 AND user_id=$2`,
            [orgId, session.user.id],
          )
          .then((r) => Number(r.rows[0]?.c ?? 0))
          .catch(() => 0),
        count(`SELECT count(*) AS c FROM logistics_trips WHERE org_id=$1`).catch(() => 0),
        count(`SELECT count(*) AS c FROM game_scoring_actions WHERE org_id=$1`).catch(() => 0),
      ]);

      let budgetsConfigured: boolean | null = null;
      let byokKeysConfigured: boolean | null = null;
      let discordConnected: boolean | null = null;
      let hasLocation: boolean | null = null;
      if (isAdmin) {
        budgetsConfigured =
          (await count(`SELECT count(*) AS c FROM org_api_budget_policies WHERE org_id=$1`)) > 0;
        byokKeysConfigured =
          (await count(
            `SELECT count(*) AS c FROM org_llm_keys
             WHERE org_id=$1 AND lower(provider) IN ('openai','anthropic','google','gemini')`,
          )) > 0 ||
          (await count(
            `SELECT count(*) AS c FROM org_provider_configs
             WHERE org_id=$1 AND enabled=true AND disabled_at IS NULL AND key_ciphertext IS NOT NULL`,
          )) > 0;
        discordConnected = (await count(`SELECT count(*) AS c FROM team_discord WHERE org_id=$1`)) > 0;
        const orgRow = membership.rows[0]!;
        hasLocation = Boolean(orgRow.city?.trim() && orgRow.stateProv?.trim());
      }

      return {
        role,
        isAdmin,
        teamNumber: membership.rows[0]!.teamNumber,
        orgName: membership.rows[0]!.orgName,
        signals: {
          hasLocation,
          members,
          pendingInvites,
          knowledgeChars: knowledgeLen,
          teamMemories: memoriesCount,
          alumni: alumniCount,
          assistantRuns: runsCount,
          budgetsConfigured,
          byokKeysConfigured,
          discordConnected,
          joinedSubteam: mySubteams > 0,
          logisticsTrips,
          kickoffActions,
        },
      };
    });
    return Response.json(data);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Getting-started request failed" },
      { status: 403 },
    );
  }
}
