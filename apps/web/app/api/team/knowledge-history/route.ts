import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

// History of the Team Knowledge doc — admin-only. Lists recent saved revisions so
// admins can see who changed the shared AI context and copy an older version back.

const LIMIT = 20;

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!session || !orgId) {
      return Response.json({ error: "Authentication and organization are required" }, { status: 401 });
    }
    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, session.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");
      const revisions = await client.query(
        `SELECT r.id, r.content, r.created_at AS "createdAt", u.email AS "editorEmail"
         FROM team_knowledge_revisions r
         LEFT JOIN users u ON u.id = r.edited_by
         WHERE r.org_id = $1
         ORDER BY r.created_at DESC
         LIMIT ${LIMIT}`,
        [orgId],
      );
      return { revisions: revisions.rows };
    });
    return Response.json(data);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Knowledge history request failed" },
      { status: 403 },
    );
  }
}
