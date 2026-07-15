import { auth } from "@vantage/core";
import { headers } from "next/headers";
import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../lib/scouting-auth";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const eventKey = url.searchParams.get("eventKey");
    const result = await withScoutingRequest(orgId, (client) =>
      client.query(
        `SELECT d.id,d.match_key AS "matchKey",d.team_key AS "teamKey",
          d.field_key AS "fieldKey",d.entry_ids AS "entryIds",d.values,d.status,
          d.resolution,d.reviewed_at AS "reviewedAt",
          u.name AS "reviewedByName"
         FROM scout_disagreements d LEFT JOIN users u ON u.id=d.reviewed_by
         WHERE d.org_id=$1 AND ($2::text IS NULL OR d.event_key=$2)
         ORDER BY CASE d.status WHEN 'open' THEN 0 ELSE 1 END,d.updated_at DESC`,
        [orgId, eventKey],
      ),
    );
    return Response.json({ disagreements: result.rows });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const body = (await request.json()) as {
      orgId?: string;
      id?: string;
      status?: "resolved" | "dismissed";
      resolution?: Record<string, unknown>;
    };
    if (!body.id || !body.status) {
      return Response.json({ error: "Review id and status are required" }, { status: 400 });
    }
    await withScoutingRequest(body.orgId ?? null, async (client) => {
      const allowed = await client.query(
        `SELECT has_org_role($1, ARRAY['owner','admin']::org_role[]) AS allowed`,
        [body.orgId],
      );
      if (!allowed.rows[0]?.allowed) throw new Error("Coach role required");
      return client.query(
        `UPDATE scout_disagreements SET status=$1,resolution=$2::jsonb,
          reviewed_by=$3,reviewed_at=now(),updated_at=now()
         WHERE id=$4 AND org_id=$5`,
        [
          body.status, JSON.stringify(body.resolution ?? {}), session.user.id,
          body.id, body.orgId,
        ],
      );
    });
    return Response.json({ ok: true });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
