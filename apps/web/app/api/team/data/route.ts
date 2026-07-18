import { assertOrgCapability, auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { notifyNextMatchReady } from "../../../../lib/notify-match";
import { loadDataSourceHealth } from "../../../../lib/reference-health";
import { runTbaEventDaySync } from "../../../../lib/reference/run-ingest";

async function current() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Team data request failed";
  if (/authentication required/i.test(message)) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  if (/organization administrator/i.test(message)) {
    return Response.json({ error: message }, { status: 403 });
  }
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    const session = await current();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");

    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await assertOrgCapability(client, orgId, "manage_api_keys");
      const active = await client.query<{ eventKey: string | null }>(
        `SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id=$1::uuid`,
        [orgId],
      );
      const inventory = (
        await client.query<{ label: string; count: number }>(
          `SELECT 'match_scouting' AS label, count(*)::int AS count FROM match_scout_entries WHERE org_id=$1::uuid
           UNION ALL SELECT 'pit_scouting', count(*)::int FROM pit_scout_entries WHERE org_id=$1::uuid
           UNION ALL SELECT 'disagreements', count(*)::int FROM scout_disagreements WHERE org_id=$1::uuid
           UNION ALL SELECT 'research_findings', count(*)::int FROM research_findings f JOIN research_jobs j ON j.id=f.research_job_id WHERE j.org_id=$1::uuid
           UNION ALL SELECT 'pick_lists', count(*)::int FROM pick_lists WHERE org_id=$1::uuid
           UNION ALL SELECT 'display_boards', count(*)::int FROM display_boards WHERE org_id=$1::uuid
           UNION ALL SELECT 'live_alerts', count(*)::int FROM org_live_alerts WHERE org_id=$1::uuid
           UNION ALL SELECT 'ai_artifacts', count(*)::int FROM ai_artifacts WHERE org_id=$1::uuid
           UNION ALL SELECT 'cad_jobs', count(*)::int FROM cad_jobs WHERE org_id=$1::uuid
           UNION ALL SELECT 'export_jobs', count(*)::int FROM export_jobs WHERE org_id=$1::uuid`,
          [orgId],
        )
      ).rows;
      const reference = (
        await client.query<{ label: string; count: number }>(
          `SELECT 'teams_ref' AS label, count(*)::int AS count FROM teams_ref
           UNION ALL SELECT 'events_ref', count(*)::int FROM events_ref
           UNION ALL SELECT 'matches_ref', count(*)::int FROM matches_ref WHERE ($1::text IS NULL OR event_key=$1::text)
           UNION ALL SELECT 'team_event_metrics', count(*)::int FROM team_event_metrics WHERE ($1::text IS NULL OR event_key=$1::text)`,
          [active.rows[0]?.eventKey ?? null],
        )
      ).rows;
      return {
        activeEventKey: active.rows[0]?.eventKey ?? null,
        inventory,
        reference,
        credentials: (
          await client.query(
            `SELECT id,source,opaque_key_id AS "opaqueKeyId",status,last_tested_at AS "lastTestedAt",last_test_status AS "lastTestStatus",disabled_at AS "disabledAt",updated_at AS "updatedAt" FROM data_source_credentials WHERE source='tba' AND org_id=$1::uuid`,
            [orgId],
          )
        ).rows,
        health:
          (
            await client.query(
              `SELECT source,status,requests_last_hour AS "requestsLastHour",rate_limit_remaining AS "rateLimitRemaining",consecutive_failures AS "consecutiveFailures",last_success_at AS "lastSuccessAt",last_failure_at AS "lastFailureAt",next_attempt_at AS "nextAttemptAt",updated_at AS "updatedAt" FROM data_source_health WHERE source='tba'`,
            )
          ).rows[0] ?? null,
        dataSourceHealth: await loadDataSourceHealth(client, orgId),
      };
    });
    return Response.json(data);
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await current();
    const body = (await request.json()) as { orgId: string; action?: "sync" };
    if (body.action !== "sync") throw new Error("Unsupported action");
    const result = await withRls({ userId: session.user.id, orgId: body.orgId }, async (client) => {
      await assertOrgCapability(client, body.orgId, "manage_api_keys");
      const active = await client.query<{ eventKey: string | null; credentialId: string | null }>(
        `SELECT c.active_event_key AS "eventKey",
                (SELECT id FROM data_source_credentials
                 WHERE source = 'tba' AND org_id = $1::uuid AND disabled_at IS NULL
                 LIMIT 1) AS "credentialId"
         FROM org_active_context c
         WHERE c.org_id = $1::uuid`,
        [body.orgId],
      );
      const eventKey = active.rows[0]?.eventKey;
      if (!eventKey) throw new Error("Select an active event before syncing TBA data for this team.");
      await client.query(
        `INSERT INTO org_live_subscriptions(org_id, enabled, fallback_credential_id, updated_by)
         VALUES ($1::uuid, true, $2::uuid, $3::uuid)
         ON CONFLICT (org_id) DO UPDATE SET
           enabled = true,
           fallback_credential_id = COALESCE(excluded.fallback_credential_id, org_live_subscriptions.fallback_credential_id),
           updated_by = excluded.updated_by,
           updated_at = now()`,
        [body.orgId, active.rows[0]?.credentialId ?? null, session.user.id],
      );
      const summary = await runTbaEventDaySync({ eventKeys: [eventKey] }, { preferOrgIds: [body.orgId] });
      const orgMeta = await client.query<{ teamNumber: number | null; eventName: string | null }>(
        `SELECT o.team_number AS "teamNumber", e.name AS "eventName"
         FROM organizations o
         LEFT JOIN events_ref e ON e.event_key = $2
         WHERE o.id = $1::uuid`,
        [body.orgId, eventKey],
      );
      let matchNotify: Awaited<ReturnType<typeof notifyNextMatchReady>> | null = null;
      try {
        matchNotify = await notifyNextMatchReady(client, {
          orgId: body.orgId,
          actorUserId: session.user.id,
          eventKey,
          eventName: orgMeta.rows[0]?.eventName ?? null,
          teamNumber: orgMeta.rows[0]?.teamNumber ?? null,
          announce: true,
        });
      } catch {
        matchNotify = null;
      }
      // Prefer SQL fingerprint alerts when migration 0155 is applied; fall back is matchNotify above.
      try {
        await client.query(`SELECT emit_match_schedule_alerts(ARRAY[$1::text])`, [eventKey]);
      } catch {
        // Function missing until 0155_my_day_schedule_alerts migrates — inbox still got matchNotify.
      }
      return { summary, matchNotify };
    });
    return Response.json({ success: true, ...result });
  } catch (error) {
    return responseError(error);
  }
}
