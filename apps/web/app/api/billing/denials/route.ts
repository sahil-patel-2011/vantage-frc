import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

// AI governance transparency: surface the AI calls the budget engine BLOCKED.
// Every denied request is already recorded to api_usage_denials with a machine
// reason (kill switch, model/provider not allowed, a spend/token limit, etc.);
// this read-only view lets admins see what was stopped and why, so a mysteriously
// failing feature can be traced to the exact policy that caught it.

const WINDOW_DAYS = 30;
const EVENT_LIMIT = 100;

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

      const [events, byReason, total] = await Promise.all([
        client.query(
          `SELECT d.id, d.created_at AS "createdAt", d.feature, d.provider, d.model,
                  d.reason, d.estimated_cost_usd AS "estimatedCostUsd",
                  d.estimated_tokens AS "estimatedTokens",
                  u.name AS "actorName", u.email AS "actorEmail"
           FROM api_usage_denials d
           LEFT JOIN users u ON u.id = d.user_id
           WHERE d.org_id = $1
           ORDER BY d.created_at DESC
           LIMIT ${EVENT_LIMIT}`,
          [orgId],
        ),
        client.query(
          `SELECT reason, count(*) AS count
           FROM api_usage_denials
           WHERE org_id=$1 AND created_at >= now() - ($2::text || ' days')::interval
           GROUP BY reason ORDER BY count DESC`,
          [orgId, WINDOW_DAYS],
        ),
        client.query(
          `SELECT count(*) AS count
           FROM api_usage_denials
           WHERE org_id=$1 AND created_at >= now() - ($2::text || ' days')::interval`,
          [orgId, WINDOW_DAYS],
        ),
      ]);

      return {
        windowDays: WINDOW_DAYS,
        total: Number(total.rows[0]?.count ?? 0),
        byReason: byReason.rows,
        events: events.rows,
      };
    });
    return Response.json(data);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Denials request failed" },
      { status: 403 },
    );
  }
}
