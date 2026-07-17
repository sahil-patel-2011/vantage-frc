import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

// AI governance transparency: a run-level history of the AI orchestrator. Unlike
// the metered usage ledger (ai_usage_events, successes only) this includes runs
// that FAILED and the provenance (context_sources) that informed each answer —
// the record you reach for to explain or debug what the assistant did. Pass a
// runId to drill into an individual run's ordered steps.

const RUN_LIMIT = 100;

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const runId = url.searchParams.get("runId");
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

      if (runId) {
        const run = await client.query(
          `SELECT r.id, r.capability, r.status, r.provider, r.model, r.error,
                  r.context_sources AS "contextSources", r.created_at AS "createdAt",
                  r.completed_at AS "completedAt", u.name AS "actorName", u.email AS "actorEmail",
                  a.cost_usd AS "costUsd", a.total_tokens AS "totalTokens"
           FROM ai_runs r
           LEFT JOIN users u ON u.id = r.user_id
           LEFT JOIN ai_usage_events a ON a.id = r.usage_event_id
           WHERE r.id = $1 AND r.org_id = $2`,
          [runId, orgId],
        );
        if (!run.rowCount) throw new Error("Run not found");
        const steps = await client.query(
          `SELECT sequence, kind, status, provenance, created_at AS "createdAt"
           FROM ai_run_steps WHERE run_id = $1 AND org_id = $2 ORDER BY sequence ASC`,
          [runId, orgId],
        );
        const artifacts = await client.query(
          `SELECT id, kind, title, version, created_at AS "createdAt"
           FROM ai_artifacts WHERE run_id = $1 AND org_id = $2 ORDER BY created_at ASC`,
          [runId, orgId],
        );
        return { run: run.rows[0], steps: steps.rows, artifacts: artifacts.rows };
      }

      const runs = await client.query(
        `SELECT r.id, r.capability, r.status, r.provider, r.model, r.error,
                jsonb_array_length(COALESCE(r.context_sources, '[]'::jsonb)) AS "sourceCount",
                r.created_at AS "createdAt", r.completed_at AS "completedAt",
                u.name AS "actorName", u.email AS "actorEmail",
                a.cost_usd AS "costUsd", a.total_tokens AS "totalTokens"
         FROM ai_runs r
         LEFT JOIN users u ON u.id = r.user_id
         LEFT JOIN ai_usage_events a ON a.id = r.usage_event_id
         WHERE r.org_id = $1
         ORDER BY r.created_at DESC
         LIMIT ${RUN_LIMIT}`,
        [orgId],
      );
      const statusCounts = await client.query<{ status: string; count: string }>(
        `SELECT status, count(*) AS count FROM ai_runs
         WHERE org_id=$1 AND created_at >= now() - interval '30 days'
         GROUP BY status`,
        [orgId],
      );
      return { runs: runs.rows, statusCounts: statusCounts.rows };
    });
    return Response.json(data);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Run history request failed" },
      { status: 403 },
    );
  }
}
