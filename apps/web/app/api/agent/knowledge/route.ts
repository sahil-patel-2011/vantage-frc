import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

// Team Knowledge Base: one markdown doc per team that the assistant reads on
// every team-scope chat (injected by AgentRepository.retrieveContext). Any member
// may read it; owners/admins edit it. Stored only in this org's team_knowledge row.

const MAX_CHARS = 20000;

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

const fail = (error: unknown) =>
  Response.json(
    { error: error instanceof Error ? error.message : "Team knowledge request failed" },
    { status: 400 },
  );

export async function GET(request: Request) {
  try {
    const current = await session();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");
    const data = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const member = await client.query<{ role: string; teamNumber: number | null }>(
        `SELECT m.role, o.team_number AS "teamNumber"
         FROM memberships m JOIN organizations o ON o.id = m.org_id
         WHERE m.org_id=$1 AND m.user_id=$2`,
        [orgId, current.user.id],
      );
      if (!member.rowCount) throw new Error("Organization access denied");
      const doc = await client.query<{ content: string; enabled: boolean; updatedAt: string | null }>(
        `SELECT content, enabled, updated_at AS "updatedAt" FROM team_knowledge WHERE org_id=$1`,
        [orgId],
      );
      return {
        teamNumber: member.rows[0]!.teamNumber,
        canEdit: ["owner", "admin"].includes(member.rows[0]!.role),
        content: doc.rows[0]?.content ?? "",
        enabled: doc.rows[0]?.enabled ?? true,
        updatedAt: doc.rows[0]?.updatedAt ?? null,
      };
    });
    return Response.json(data);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as { orgId?: string; content?: string; enabled?: boolean };
    if (!body.orgId) throw new Error("orgId is required");
    const orgId = body.orgId;
    const content = String(body.content ?? "");
    if (content.length > MAX_CHARS) throw new Error(`Knowledge doc must be ${MAX_CHARS} characters or fewer`);
    await withRls({ userId: current.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, current.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");
      await client.query(
        `INSERT INTO team_knowledge(org_id, content, enabled, updated_by, updated_at)
         VALUES($1, $2, $3, $4, now())
         ON CONFLICT(org_id) DO UPDATE SET
           content=excluded.content, enabled=excluded.enabled,
           updated_by=excluded.updated_by, updated_at=now()`,
        [orgId, content, body.enabled ?? true, current.user.id],
      );
    });
    return Response.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
