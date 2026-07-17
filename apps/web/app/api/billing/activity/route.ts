import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

// AI governance transparency: a read-only per-call activity log over the metered
// usage ledger (ai_usage_events). Aggregate spend already lives at /api/billing/usage;
// this surfaces individual calls — who ran which model on which feature, funded by which
// key source, with the provenance tags the orchestrator records in metadata.

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

      const [events, byKeySource, byFeature, totals] = await Promise.all([
        client.query(
          `SELECT a.id, a.created_at AS "createdAt", a.feature, a.provider, a.model,
                  a.key_source AS "keySource", a.prompt_tokens AS "promptTokens",
                  a.completion_tokens AS "completionTokens", a.total_tokens AS "totalTokens",
                  a.cache_read_input_tokens AS "cacheReadTokens",
                  a.cache_write_input_tokens AS "cacheWriteTokens",
                  a.cost_usd AS "costUsd",
                  a.metadata->>'usageTag' AS "usageTag",
                  u.name AS "actorName", u.email AS "actorEmail"
           FROM ai_usage_events a
           LEFT JOIN users u ON u.id = a.user_id
           WHERE a.org_id = $1
           ORDER BY a.created_at DESC
           LIMIT ${EVENT_LIMIT}`,
          [orgId],
        ),
        client.query(
          `SELECT key_source AS "keySource", count(*) AS calls,
                  COALESCE(sum(cost_usd),0) AS cost, COALESCE(sum(total_tokens),0) AS tokens
           FROM ai_usage_events
           WHERE org_id=$1 AND created_at >= now() - ($2::text || ' days')::interval
           GROUP BY key_source ORDER BY cost DESC`,
          [orgId, WINDOW_DAYS],
        ),
        client.query(
          `SELECT feature, count(*) AS calls, COALESCE(sum(cost_usd),0) AS cost,
                  COALESCE(sum(total_tokens),0) AS tokens
           FROM ai_usage_events
           WHERE org_id=$1 AND created_at >= now() - ($2::text || ' days')::interval
           GROUP BY feature ORDER BY cost DESC`,
          [orgId, WINDOW_DAYS],
        ),
        client.query(
          `SELECT count(*) AS calls, COALESCE(sum(cost_usd),0) AS cost,
                  COALESCE(sum(total_tokens),0) AS tokens,
                  COALESCE(sum(cache_read_input_tokens),0) AS "cacheReadTokens"
           FROM ai_usage_events
           WHERE org_id=$1 AND created_at >= now() - ($2::text || ' days')::interval`,
          [orgId, WINDOW_DAYS],
        ),
      ]);

      return {
        windowDays: WINDOW_DAYS,
        summary: totals.rows[0] ?? { calls: 0, cost: 0, tokens: 0, cacheReadTokens: 0 },
        byKeySource: byKeySource.rows,
        byFeature: byFeature.rows,
        events: events.rows,
      };
    });
    return Response.json(data);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Activity request failed" },
      { status: 403 },
    );
  }
}
