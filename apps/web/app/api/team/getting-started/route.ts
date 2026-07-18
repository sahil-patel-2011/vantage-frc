import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

// Team transition/onboarding checklist. Aggregates the real state of a workspace
// so a team moving in can see, at a glance, what is set up and what is left:
// members invited, team knowledge written, AI budgets configured, the assistant
// tried, alumni network started, Discord connected. All member-readable except
// admin-only signals (budgets, Discord), which are gated by the viewer's role.

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!session || !orgId) {
      return Response.json({ error: "Authentication and organization are required" }, { status: 401 });
    }
    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const membership = await client.query<{ role: string; teamNumber: number | null; orgName: string }>(
        `SELECT m.role, o.team_number AS "teamNumber", o.name AS "orgName"
         FROM memberships m JOIN organizations o ON o.id = m.org_id
         WHERE m.org_id=$1 AND m.user_id=$2`,
        [orgId, session.user.id],
      );
      if (!membership.rowCount) throw new Error("Organization access denied");
      const role = membership.rows[0]!.role;
      const isAdmin = ["owner", "admin"].includes(role);

      const count = async (sql: string) =>
        Number((await client.query<{ c: string }>(sql, [orgId])).rows[0]?.c ?? 0);

      const [members, pendingInvites, knowledgeLen, memoriesCount, alumniCount, runsCount] = await Promise.all([
        count(`SELECT count(*) AS c FROM memberships WHERE org_id=$1`),
        count(`SELECT count(*) AS c FROM invites WHERE org_id=$1 AND status='pending'`),
        count(`SELECT COALESCE(length(btrim(content)),0) AS c FROM team_knowledge WHERE org_id=$1`),
        count(`SELECT count(*) AS c FROM team_memories WHERE org_id=$1`),
        count(`SELECT count(*) AS c FROM team_alumni WHERE org_id=$1`),
        count(`SELECT count(*) AS c FROM ai_runs WHERE org_id=$1`),
      ]);

      let budgetsConfigured: boolean | null = null;
      let discordConnected: boolean | null = null;
      if (isAdmin) {
        budgetsConfigured =
          (await count(`SELECT count(*) AS c FROM org_api_budget_policies WHERE org_id=$1`)) > 0;
        discordConnected = (await count(`SELECT count(*) AS c FROM team_discord WHERE org_id=$1`)) > 0;
      }

      return {
        role,
        isAdmin,
        teamNumber: membership.rows[0]!.teamNumber,
        orgName: membership.rows[0]!.orgName,
        signals: {
          members,
          pendingInvites,
          knowledgeChars: knowledgeLen,
          teamMemories: memoriesCount,
          alumni: alumniCount,
          assistantRuns: runsCount,
          budgetsConfigured,
          discordConnected,
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
