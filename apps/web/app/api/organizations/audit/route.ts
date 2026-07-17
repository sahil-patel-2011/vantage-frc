import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

// Org-facing security audit trail. Merges the two org-scoped audit streams that
// already record accountable actions — membership/invite/capability changes
// (membership_audit_events) and authentication-policy / MFA changes
// (auth_policy_audit_events) — into one reverse-chronological feed for admins.

const EVENT_LIMIT = 150;

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!session || !orgId) {
      return Response.json(
        { error: "Authentication and organization are required" },
        { status: 401 },
      );
    }
    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, session.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");

      const events = await client.query(
        `SELECT category, id::text AS id, created_at AS "createdAt", action, metadata,
                actor_name AS "actorName", actor_email AS "actorEmail"
         FROM (
           SELECT 'membership' AS category, e.id, e.created_at, e.action, e.metadata,
                  e.actor_user_id, u.name AS actor_name, u.email AS actor_email
           FROM membership_audit_events e
           LEFT JOIN users u ON u.id = e.actor_user_id
           WHERE e.org_id = $1
           UNION ALL
           SELECT 'auth' AS category, e.id, e.created_at, e.action, e.metadata,
                  e.actor_user_id, u.name AS actor_name, u.email AS actor_email
           FROM auth_policy_audit_events e
           LEFT JOIN users u ON u.id = e.actor_user_id
           WHERE e.org_id = $1
         ) merged
         ORDER BY "createdAt" DESC
         LIMIT ${EVENT_LIMIT}`,
        [orgId],
      );

      return { events: events.rows };
    });
    return Response.json(data);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Audit request failed" },
      { status: 403 },
    );
  }
}
