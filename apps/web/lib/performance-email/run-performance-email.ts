import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv } from "@vantage/db/postgres-url";
import { CommitAndThrowError } from "@vantage/db";
import type { Pool, PoolClient } from "@neondatabase/serverless";
import { getOrgPromptCachingEnabled, resolveOrgChatAdapter } from "@vantage/agent";
import { createBridgeTransport } from "../ai-bridge/transport";
import { meteredAI } from "@vantage/billing";
import { sendPerformanceDigestEmail } from "@vantage/core";
import {
  buildPerformanceDigestPrompt,
  computePerformanceDigest,
  renderPerformanceEmailHtml,
  renderPerformanceEmailText,
  type PerformanceDigest,
  type PerformanceMatchRow,
} from "./compute-performance-email";

/**
 * Daily team performance email worker (see docs/PERFORMANCE_EMAIL.md).
 *
 * Worker-only: runs on the admin connection (vantage_worker) from the
 * /api/cron/team-performance-email route — never from request paths, mirroring
 * run-sponsor-reminders.ts / run-dream.ts. It enumerates only orgs with REAL
 * data for the UTC day (scored matches involving the team, or scouting
 * activity); everyone else gets nothing. Per member it claims a
 * performance_email_log row BEFORE sending, so re-runs never double-send, then
 * delivers through the default-ON `performance_digest` opt-in email path
 * (unsubscribe footer included by @vantage/core). An optional AI paragraph is
 * added only when the org's own chat adapter resolves; the deterministic
 * digest ships either way.
 */

export type PerformanceEmailRunSummary = {
  orgsScanned: number;
  orgsWithData: number;
  emailsSent: number;
  skippedPref: number;
  alreadyLogged: number;
  failed: number;
  aiParagraphs: number;
  errors: string[];
};

const MAX_ORGS_PER_RUN = 500;
const MAX_MEMBERS_PER_ORG = 300;
const MATCH_LIST_LIMIT = 25;
const UPCOMING_LIST_LIMIT = 8;
const AI_PARAGRAPH_MAX_CHARS = 900;

function workerPool(): Pool {
  const connectionString = firstConfiguredEnv(
    "DATABASE_ADMIN_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL",
    "POSTGRES_URL",
  );
  if (!connectionString) {
    throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required for the performance email cron");
  }
  return createSqlPool(connectionString);
}

type DigestOrg = { orgId: string; orgName: string; teamNumber: number };

/** Only orgs with real data today — scored matches for their team, or scouting entries. */
async function listOrgsWithDataToday(
  client: PoolClient,
  window: { startIso: string; endIso: string },
  orgId?: string,
): Promise<DigestOrg[]> {
  const result = await client.query<DigestOrg>(
    `SELECT o.id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber"
     FROM organizations o
     WHERE COALESCE(o.is_demo, false) = false
       AND o.team_number IS NOT NULL
       AND ($1::uuid IS NULL OR o.id = $1::uuid)
       AND (
         EXISTS (
           SELECT 1 FROM matches_ref m
           WHERE (
               m.red_alliance->'teamKeys' ? ('frc' || o.team_number::text)
               OR m.blue_alliance->'teamKeys' ? ('frc' || o.team_number::text)
             )
             AND COALESCE(m.actual_time, m.post_result_time) >= $2::timestamptz
             AND COALESCE(m.actual_time, m.post_result_time) < $3::timestamptz
             AND (m.red_alliance->>'score') IS NOT NULL
             AND (m.red_alliance->>'score')::numeric >= 0
             AND (m.blue_alliance->>'score') IS NOT NULL
             AND (m.blue_alliance->>'score')::numeric >= 0
         )
         OR EXISTS (
           SELECT 1 FROM match_scout_entries s
           WHERE s.org_id = o.id AND s.created_at >= $2::timestamptz AND s.created_at < $3::timestamptz
         )
         OR EXISTS (
           SELECT 1 FROM pit_scout_entries p
           WHERE p.org_id = o.id AND p.created_at >= $2::timestamptz AND p.created_at < $3::timestamptz
         )
       )
     ORDER BY o.id
     LIMIT ${MAX_ORGS_PER_RUN}`,
    [orgId ?? null, window.startIso, window.endIso],
  );
  return result.rows;
}

type MatchRefRow = {
  matchKey: string;
  eventKey: string;
  compLevel: string;
  setNumber: number;
  matchNumber: number;
  red: { teamKeys?: string[]; score?: number | string | null };
  blue: { teamKeys?: string[]; score?: number | string | null };
  scoreBreakdown: unknown;
  scheduledAt: string | null;
};

function toPerformanceRow(row: MatchRefRow): PerformanceMatchRow {
  return {
    matchKey: row.matchKey,
    compLevel: row.compLevel,
    setNumber: row.setNumber,
    matchNumber: row.matchNumber,
    red: row.red ?? {},
    blue: row.blue ?? {},
    scoreBreakdown: row.scoreBreakdown,
    scheduledAt: row.scheduledAt,
  };
}

async function loadMatchesToday(
  client: PoolClient,
  teamKey: string,
  window: { startIso: string; endIso: string },
): Promise<MatchRefRow[]> {
  const result = await client.query<MatchRefRow>(
    `SELECT m.match_key AS "matchKey", m.event_key AS "eventKey", m.comp_level AS "compLevel",
            m.set_number AS "setNumber", m.match_number AS "matchNumber",
            m.red_alliance AS "red", m.blue_alliance AS "blue",
            m.score_breakdown AS "scoreBreakdown",
            COALESCE(m.actual_time, m.post_result_time)::text AS "scheduledAt"
     FROM matches_ref m
     WHERE (m.red_alliance->'teamKeys' ? $1 OR m.blue_alliance->'teamKeys' ? $1)
       AND COALESCE(m.actual_time, m.post_result_time) >= $2::timestamptz
       AND COALESCE(m.actual_time, m.post_result_time) < $3::timestamptz
       AND (m.red_alliance->>'score') IS NOT NULL
       AND (m.red_alliance->>'score')::numeric >= 0
       AND (m.blue_alliance->>'score') IS NOT NULL
       AND (m.blue_alliance->>'score')::numeric >= 0
     ORDER BY COALESCE(m.actual_time, m.post_result_time)
     LIMIT ${MATCH_LIST_LIMIT}`,
    [teamKey, window.startIso, window.endIso],
  );
  return result.rows;
}

async function loadUpcomingMatches(
  client: PoolClient,
  teamKey: string,
  eventKey: string,
  window: { endIso: string; nextEndIso: string },
): Promise<MatchRefRow[]> {
  const result = await client.query<MatchRefRow>(
    `SELECT m.match_key AS "matchKey", m.event_key AS "eventKey", m.comp_level AS "compLevel",
            m.set_number AS "setNumber", m.match_number AS "matchNumber",
            m.red_alliance AS "red", m.blue_alliance AS "blue",
            m.score_breakdown AS "scoreBreakdown",
            COALESCE(m.predicted_time, m.event_time)::text AS "scheduledAt"
     FROM matches_ref m
     WHERE m.event_key = $1
       AND (m.red_alliance->'teamKeys' ? $2 OR m.blue_alliance->'teamKeys' ? $2)
       AND ((m.red_alliance->>'score') IS NULL OR (m.red_alliance->>'score')::numeric < 0)
       AND COALESCE(m.predicted_time, m.event_time) >= $3::timestamptz
       AND COALESCE(m.predicted_time, m.event_time) < $4::timestamptz
     ORDER BY COALESCE(m.predicted_time, m.event_time)
     LIMIT ${UPCOMING_LIST_LIMIT}`,
    [eventKey, teamKey, window.endIso, window.nextEndIso],
  );
  return result.rows;
}

async function loadEventName(client: PoolClient, eventKey: string): Promise<string | null> {
  const result = await client.query<{ name: string | null }>(
    `SELECT COALESCE(short_name, name) AS name FROM events_ref WHERE event_key = $1`,
    [eventKey],
  );
  return result.rows[0]?.name ?? null;
}

async function loadEventMetrics(client: PoolClient, teamKey: string, eventKey: string) {
  const result = await client.query<{
    rank: number | null;
    wins: number | null;
    losses: number | null;
    ties: number | null;
    source: string;
  }>(
    `SELECT rank, wins, losses, ties, source
     FROM team_event_metrics
     WHERE team_key = $1 AND event_key = $2
     ORDER BY (rank IS NULL), CASE source WHEN 'tba' THEN 0 ELSE 1 END
     LIMIT 1`,
    [teamKey, eventKey],
  );
  return result.rows[0] ?? null;
}

async function loadScoutingToday(
  client: PoolClient,
  orgId: string,
  eventKey: string | null,
  window: { startIso: string; endIso: string },
) {
  const counts = await client.query<{ entries: number; scouts: number; matchesScouted: number }>(
    `SELECT
       (SELECT count(*)::int FROM match_scout_entries s
         WHERE s.org_id = $1::uuid AND s.created_at >= $2::timestamptz AND s.created_at < $3::timestamptz)
       + (SELECT count(*)::int FROM pit_scout_entries p
         WHERE p.org_id = $1::uuid AND p.created_at >= $2::timestamptz AND p.created_at < $3::timestamptz)
       AS entries,
       (SELECT count(DISTINCT scout_user_id)::int FROM (
          SELECT scout_user_id FROM match_scout_entries s
           WHERE s.org_id = $1::uuid AND s.created_at >= $2::timestamptz AND s.created_at < $3::timestamptz
          UNION ALL
          SELECT scout_user_id FROM pit_scout_entries p
           WHERE p.org_id = $1::uuid AND p.created_at >= $2::timestamptz AND p.created_at < $3::timestamptz
        ) scouts_u) AS scouts,
       (SELECT count(DISTINCT s.match_key)::int FROM match_scout_entries s
         WHERE s.org_id = $1::uuid AND s.created_at >= $2::timestamptz AND s.created_at < $3::timestamptz
           AND ($4::text IS NULL OR s.event_key = $4)) AS "matchesScouted"`,
    [orgId, window.startIso, window.endIso, eventKey],
  );
  const row = counts.rows[0];
  if (!row || row.entries === 0) return null;

  let matchesPlayedAtEvent = 0;
  if (eventKey) {
    const played = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM matches_ref m
       WHERE m.event_key = $1
         AND COALESCE(m.actual_time, m.post_result_time) >= $2::timestamptz
         AND COALESCE(m.actual_time, m.post_result_time) < $3::timestamptz
         AND (m.red_alliance->>'score') IS NOT NULL
         AND (m.red_alliance->>'score')::numeric >= 0`,
      [eventKey, window.startIso, window.endIso],
    );
    matchesPlayedAtEvent = played.rows[0]?.count ?? 0;
  }

  return {
    entries: row.entries,
    scouts: row.scouts,
    matchesScouted: row.matchesScouted,
    matchesPlayedAtEvent,
  };
}

/**
 * Optional AI paragraph through the metered billing path
 * (feature=performance_digest, attributed to the org's owner). ANY failure —
 * no adapter/key, billing cap, HTTP error — returns null and the
 * deterministic digest ships without it. Never throws.
 */
async function tryAiParagraph(
  client: PoolClient,
  input: { orgId: string; day: string; digest: PerformanceDigest },
): Promise<string | null> {
  try {
    const owner = await client.query<{ userId: string }>(
      `SELECT user_id AS "userId" FROM memberships
       WHERE org_id = $1::uuid
       ORDER BY CASE role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at
       LIMIT 1`,
      [input.orgId],
    );
    const ownerId = owner.rows[0]?.userId;
    if (!ownerId) return null;

    const promptCachingEnabled = await getOrgPromptCachingEnabled(client, input.orgId).catch(() => true);
    // Honest feature tag: the weekly digest is batch work — bridge only under
    // coverage='everything'.
    const adapter = await resolveOrgChatAdapter(client, {
      orgId: input.orgId,
      promptCachingEnabled,
      feature: "performance_digest",
      bridgeTransport: createBridgeTransport(),
    });
    const prompt = buildPerformanceDigestPrompt(input.digest);

    await client.query("BEGIN");
    try {
      const completion = await meteredAI({
        client,
        orgId: input.orgId,
        userId: ownerId,
        feature: "performance_digest",
        requestId: crypto.randomUUID(),
        estimatedCostUsd: 0,
        estimatedPromptTokens: Math.ceil(prompt.length / 4),
        estimatedCompletionTokens: 300,
        provider: adapter.provider,
        model: adapter.model,
        metadata: { day: input.day, path: "performance_email_cron" },
        invoke: async () => {
          const response = await adapter.complete({
            message: prompt,
            context: [],
            promptCachingEnabled,
          });
          return {
            value: response,
            promptTokens: response.promptTokens,
            completionTokens: response.completionTokens,
            costUsd: response.costUsd,
            model: adapter.model,
            provider: adapter.provider,
            cacheReadInputTokens: response.cacheReadInputTokens,
            cacheWriteInputTokens: response.cacheWriteInputTokens,
            uncachedInputTokens: response.uncachedInputTokens,
          };
        },
      });
      await client.query("COMMIT");
      const text = completion.text.trim();
      return text ? text.slice(0, AI_PARAGRAPH_MAX_CHARS) : null;
    } catch (error) {
      // meteredAI signals "commit the denial record, then fail" via CommitAndThrowError.
      if (error instanceof CommitAndThrowError) {
        await client.query("COMMIT").catch(() => {});
      } else {
        await client.query("ROLLBACK").catch(() => {});
      }
      throw error;
    }
  } catch {
    return null;
  }
}

/**
 * Claim the (org, user, day) log row BEFORE sending. Returns false when a row
 * already exists — a previous run handled (or attempted) this member, so we
 * never send again for the day. The provisional status is 'failed' so a crash
 * mid-send leaves an honest record; the real status is written after the
 * attempt.
 */
async function claimLogRow(
  client: PoolClient,
  orgId: string,
  userId: string,
  day: string,
): Promise<boolean> {
  const inserted = await client.query(
    `INSERT INTO performance_email_log (org_id, user_id, day, status, detail)
     VALUES ($1::uuid, $2::uuid, $3::date, 'failed', 'claimed')
     ON CONFLICT (org_id, user_id, day) DO NOTHING
     RETURNING id`,
    [orgId, userId, day],
  );
  return Boolean(inserted.rowCount);
}

async function finalizeLogRow(
  client: PoolClient,
  input: { orgId: string; userId: string; day: string; status: "sent" | "skipped_pref" | "failed"; detail: string | null },
): Promise<void> {
  await client.query(
    `UPDATE performance_email_log
     SET status = $4, detail = $5, updated_at = now()
     WHERE org_id = $1::uuid AND user_id = $2::uuid AND day = $3::date`,
    [input.orgId, input.userId, input.day, input.status, input.detail],
  );
}

async function digestOneOrg(
  client: PoolClient,
  org: DigestOrg,
  context: { day: string; startIso: string; endIso: string; nextEndIso: string },
  summary: PerformanceEmailRunSummary,
): Promise<void> {
  const teamKey = `frc${org.teamNumber}`;
  const window = { startIso: context.startIso, endIso: context.endIso };

  const matchRows = await loadMatchesToday(client, teamKey, window);

  // Event context: the event the team actually played at today; otherwise the
  // org's active event when its window covers today (off-season/scouting days).
  let eventKey: string | null = matchRows[0]?.eventKey ?? null;
  if (!eventKey) {
    const active = await client.query<{ eventKey: string | null }>(
      `SELECT c.active_event_key AS "eventKey"
       FROM org_active_context c
       JOIN events_ref e ON e.event_key = c.active_event_key
       WHERE c.org_id = $1::uuid AND e.start_date <= $2::date AND e.end_date >= $2::date`,
      [org.orgId, context.day],
    );
    eventKey = active.rows[0]?.eventKey ?? null;
  }

  const [eventName, metrics, scouting, upcomingRows] = await Promise.all([
    eventKey ? loadEventName(client, eventKey) : Promise.resolve(null),
    eventKey ? loadEventMetrics(client, teamKey, eventKey) : Promise.resolve(null),
    loadScoutingToday(client, org.orgId, eventKey, window),
    eventKey
      ? loadUpcomingMatches(client, teamKey, eventKey, {
          endIso: context.endIso,
          nextEndIso: context.nextEndIso,
        })
      : Promise.resolve([]),
  ]);

  const digest = computePerformanceDigest({
    orgName: org.orgName,
    teamNumber: org.teamNumber,
    day: context.day,
    eventKey,
    eventName,
    matchesToday: matchRows.map(toPerformanceRow),
    upcomingMatches: upcomingRows.map(toPerformanceRow),
    metrics,
    scouting,
  });
  if (!digest) return; // no real data — send nothing, log nothing.
  summary.orgsWithData += 1;

  const aiParagraph = await tryAiParagraph(client, { orgId: org.orgId, day: context.day, digest });
  if (aiParagraph) summary.aiParagraphs += 1;
  const text = renderPerformanceEmailText(digest, aiParagraph);
  const html = renderPerformanceEmailHtml(digest, aiParagraph);

  const members = await client.query<{ userId: string }>(
    `SELECT user_id AS "userId" FROM memberships
     WHERE org_id = $1::uuid
     ORDER BY created_at
     LIMIT ${MAX_MEMBERS_PER_ORG}`,
    [org.orgId],
  );

  for (const member of members.rows) {
    const claimed = await claimLogRow(client, org.orgId, member.userId, context.day);
    if (!claimed) {
      summary.alreadyLogged += 1;
      continue;
    }
    let status: "sent" | "skipped_pref" | "failed";
    let detail: string | null = null;
    try {
      const delivery = await sendPerformanceDigestEmail(client, {
        userId: member.userId,
        subject: digest.subject,
        text,
        html,
      });
      if (delivery.status === "sent") {
        status = "sent";
      } else if (delivery.status === "skipped") {
        status = "skipped_pref";
        detail = delivery.reason;
      } else {
        status = "failed";
        detail = delivery.reason;
      }
    } catch (error) {
      status = "failed";
      detail = error instanceof Error ? error.message.slice(0, 300) : "send failed";
    }
    await finalizeLogRow(client, {
      orgId: org.orgId,
      userId: member.userId,
      day: context.day,
      status,
      detail,
    });
    if (status === "sent") summary.emailsSent += 1;
    else if (status === "skipped_pref") summary.skippedPref += 1;
    else summary.failed += 1;
  }
}

/** Daily worker: one honest performance email per member on days with real data. */
export async function runPerformanceEmail(
  options: { orgId?: string; now?: Date } = {},
): Promise<PerformanceEmailRunSummary> {
  const now = options.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const startIso = `${day}T00:00:00.000Z`;
  const endIso = new Date(Date.parse(startIso) + 24 * 60 * 60 * 1000).toISOString();
  const nextEndIso = new Date(Date.parse(startIso) + 48 * 60 * 60 * 1000).toISOString();

  const summary: PerformanceEmailRunSummary = {
    orgsScanned: 0,
    orgsWithData: 0,
    emailsSent: 0,
    skippedPref: 0,
    alreadyLogged: 0,
    failed: 0,
    aiParagraphs: 0,
    errors: [],
  };

  const pool = workerPool();
  const client = await pool.connect();
  try {
    const orgs = await listOrgsWithDataToday(client, { startIso, endIso }, options.orgId);
    summary.orgsScanned = orgs.length;
    for (const org of orgs) {
      try {
        await digestOneOrg(client, org, { day, startIso, endIso, nextEndIso }, summary);
      } catch (error) {
        // Leave a failed transaction (if any) unwound before the next org.
        await client.query("ROLLBACK").catch(() => {});
        summary.errors.push(
          `${org.orgId}: ${error instanceof Error ? error.message : "performance email failed"}`,
        );
      }
    }
    return summary;
  } finally {
    client.release();
    await pool.end();
  }
}
