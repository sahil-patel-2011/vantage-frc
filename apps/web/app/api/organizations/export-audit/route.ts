import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

// Data-governance accountability: who exported a copy of this team's data, when,
// at what scope, and whether they downloaded it. The export center already
// records export.requested / export.completed / export.downloaded into
// export_audit_events; its RLS lets org owners/admins read the whole org trail.
// This is the reader — a data-exfiltration audit surface that had no UI.

const LIMIT = 100;

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

      const [events, byAction] = await Promise.all([
        client.query(
          `SELECT e.id, e.created_at AS "createdAt", e.action, e.reason, e.metadata,
                  e.job_id AS "jobId", u.name AS "actorName", u.email AS "actorEmail",
                  j.scope, j.status
           FROM export_audit_events e
           LEFT JOIN users u ON u.id = e.actor_user_id
           LEFT JOIN export_jobs j ON j.id = e.job_id
           WHERE e.org_id = $1
           ORDER BY e.created_at DESC
           LIMIT ${LIMIT}`,
          [orgId],
        ),
        client.query(
          `SELECT action, count(*) AS count FROM export_audit_events
           WHERE org_id=$1 AND created_at >= now() - interval '30 days'
           GROUP BY action ORDER BY count DESC`,
          [orgId],
        ),
      ]);
      return { events: events.rows, byAction: byAction.rows };
    });
    return Response.json(data);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Export audit request failed" },
      { status: 403 },
    );
  }
}
