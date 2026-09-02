import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv } from "@vantage/db/postgres-url";
import { CommitAndThrowError } from "@vantage/db";
import type { Pool, PoolClient } from "@neondatabase/serverless";
import { getOrgPromptCachingEnabled, resolveOrgChatAdapter } from "@vantage/agent";
import { createBridgeTransport } from "../ai-bridge/transport";
import { meteredAI } from "@vantage/billing";
import {
  assembleDreamPrompt,
  clampExcerpt,
  deterministicDigest,
  emptyDreamDigest,
  hasActivity,
  matchOutcome,
  type DreamDigest,
  type DreamGrantDeadline,
  type DreamIncident,
  type DreamMatchResult,
} from "./compute-dream";
import {
  assembleWeekPrompt,
  deterministicWeek,
  hasWeekMaterial,
  isWeeklyRollupDay,
  weekWindow,
  type WeekDigest,
} from "./compute-week";
import {
  digestSourceCounts,
  parseSourceCounts,
  sumSourceCounts,
  type DreamSourceCounts,
} from "./journal";

/**
 * Nightly team memory consolidation ("dreaming").
 *
 * Worker-only: runs on the admin connection (vantage_worker) from the
 * /api/cron/team-dream route — never from request paths. For each org with
 * team memory enabled it digests the last 24h of REAL activity, asks the
 * org's own chat adapter (BYOK / member keys / sponsored pool) to write a
 * compact recap, and stores it as ONE team_memories row per day
 * (source='dream'). Idle orgs write no memory; when no adapter resolves or
 * the call fails, the deterministic plain-text digest of the same facts is
 * stored instead. Every attempt lands in team_dream_runs.
 */

export type TeamDreamRunSummary = {
  processed: number;
  ok: number;
  noActivity: number;
  fallback: number;
  errors: number;
  /** Weekly roll-up counters — all zero on the six non-Saturday nights. */
  weeklyProcessed: number;
  weeklyOk: number;
  weeklySkipped: number;
  weeklyErrors: number;
};

const MAX_ORGS_PER_RUN = 500;
const LIST_LIMIT = 10;
const MESSAGE_LIST_LIMIT = 15;
/** ~800 tokens; the HTTP adapters also hard-cap completions at 1024 tokens. */
const MEMORY_MAX_CHARS = 3200;
const ERROR_CLASS_MAX_CHARS = 120;

/** Activity sources that may be absent in older databases — guarded via to_regclass. */
const SOURCE_TABLES = [
  "org_messages",
  "match_scout_entries",
  "pit_scout_entries",
  "decision_records",
  "build_tasks",
  "subteam_calendar_events",
  "incident_reports",
  "pit_repair_triage_reports",
  "cad_jobs",
  "hour_logs",
  "learning_predictions",
  "org_active_context",
  "matches_ref",
  "bug_reports",
  "grant_opportunities",
  "grant_calendar_opportunities",
  "grant_calendar_watchlist",
] as const;

/** Deadlines are surfaced on the day they cross into this horizon, once. */
const GRANT_DEADLINE_HORIZON_DAYS = 14;

type SourceTable = (typeof SOURCE_TABLES)[number];

function workerPool(): Pool {
  const connectionString = firstConfiguredEnv(
    "DATABASE_ADMIN_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL",
    "POSTGRES_URL",
  );
  if (!connectionString) {
    throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required for the team dream cron");
  }
  return createSqlPool(connectionString);
}

async function listPresentTables(client: PoolClient): Promise<Set<SourceTable>> {
  const result = await client.query<{ name: SourceTable }>(
    `SELECT t.name FROM unnest($1::text[]) AS t(name)
     WHERE to_regclass('public.' || t.name) IS NOT NULL`,
    [[...SOURCE_TABLES]],
  );
  return new Set(result.rows.map((row) => row.name));
}

type DreamOrg = { orgId: string; orgName: string; retentionDays: number };

async function listEnabledOrgs(client: PoolClient, orgId?: string): Promise<DreamOrg[]> {
  const result = await client.query<DreamOrg>(
    `SELECT s.org_id AS "orgId", o.name AS "orgName", s.retention_days AS "retentionDays"
     FROM team_memory_settings s
     JOIN organizations o ON o.id = s.org_id
     WHERE s.enabled = true AND ($1::uuid IS NULL OR s.org_id = $1::uuid)
     ORDER BY s.org_id
     LIMIT ${MAX_ORGS_PER_RUN}`,
    [orgId ?? null],
  );
  return result.rows;
}

async function gatherDreamDigest(
  client: PoolClient,
  input: { orgId: string; orgName: string; day: string; sinceIso: string; tables: Set<SourceTable> },
): Promise<DreamDigest> {
  const { orgId, sinceIso, tables } = input;
  const digest = emptyDreamDigest(input.orgName, input.day);

  if (tables.has("org_messages")) {
    const count = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM org_messages
       WHERE org_id = $1::uuid AND created_at >= $2::timestamptz AND deleted_at IS NULL`,
      [orgId, sinceIso],
    );
    digest.messages.count = count.rows[0]?.count ?? 0;
    if (digest.messages.count > 0) {
      const recent = await client.query<{ author: string; body: string }>(
        `SELECT u.name AS author, m.body
         FROM org_messages m JOIN users u ON u.id = m.author_user_id
         WHERE m.org_id = $1::uuid AND m.created_at >= $2::timestamptz AND m.deleted_at IS NULL
         ORDER BY m.created_at DESC
         LIMIT ${MESSAGE_LIST_LIMIT}`,
        [orgId, sinceIso],
      );
      digest.messages.recent = recent.rows.map((row) => ({
        author: row.author,
        excerpt: clampExcerpt(row.body),
      }));
    }
  }

  const scoutingByEvent = new Map<string, { matchEntries: number; pitEntries: number }>();
  if (tables.has("match_scout_entries")) {
    const rows = await client.query<{ eventKey: string; count: number }>(
      `SELECT event_key AS "eventKey", count(*)::int AS count
       FROM match_scout_entries
       WHERE org_id = $1::uuid AND created_at >= $2::timestamptz
       GROUP BY event_key ORDER BY count DESC
       LIMIT ${LIST_LIMIT}`,
      [orgId, sinceIso],
    );
    for (const row of rows.rows) {
      scoutingByEvent.set(row.eventKey, { matchEntries: row.count, pitEntries: 0 });
    }
  }
  if (tables.has("pit_scout_entries")) {
    const rows = await client.query<{ eventKey: string; count: number }>(
      `SELECT event_key AS "eventKey", count(*)::int AS count
       FROM pit_scout_entries
       WHERE org_id = $1::uuid AND created_at >= $2::timestamptz
       GROUP BY event_key ORDER BY count DESC
       LIMIT ${LIST_LIMIT}`,
      [orgId, sinceIso],
    );
    for (const row of rows.rows) {
      const existing = scoutingByEvent.get(row.eventKey) ?? { matchEntries: 0, pitEntries: 0 };
      existing.pitEntries += row.count;
      scoutingByEvent.set(row.eventKey, existing);
    }
  }
  digest.scouting.byEvent = [...scoutingByEvent.entries()].map(([eventKey, counts]) => ({
    eventKey,
    ...counts,
  }));
  digest.scouting.total = digest.scouting.byEvent.reduce(
    (sum, event) => sum + event.matchEntries + event.pitEntries,
    0,
  );

  if (tables.has("decision_records")) {
    const rows = await client.query<{
      title: string;
      category: string;
      status: string;
      total: number;
    }>(
      `SELECT title, category, status, count(*) OVER ()::int AS total
       FROM decision_records
       WHERE org_id = $1::uuid AND created_at >= $2::timestamptz
       ORDER BY created_at DESC
       LIMIT ${LIST_LIMIT}`,
      [orgId, sinceIso],
    );
    digest.decisions.count = rows.rows[0]?.total ?? 0;
    digest.decisions.items = rows.rows.map((row) => ({
      title: clampExcerpt(row.title),
      category: row.category,
      status: row.status,
    }));
  }

  if (tables.has("build_tasks")) {
    const rows = await client.query<{ title: string; subsystem: string | null; total: number }>(
      `SELECT title, subsystem, count(*) OVER ()::int AS total
       FROM build_tasks
       WHERE org_id = $1::uuid AND status = 'done' AND done_at >= $2::timestamptz
       ORDER BY done_at DESC
       LIMIT ${LIST_LIMIT}`,
      [orgId, sinceIso],
    );
    digest.tasksCompleted.count += rows.rows[0]?.total ?? 0;
    digest.tasksCompleted.items.push(
      ...rows.rows.map((row) => ({
        title: clampExcerpt(row.title),
        source: "build" as const,
        subsystem: row.subsystem,
      })),
    );
  }
  // team_todos was folded into build_tasks (0502); the build block above already
  // counts every completed task, so a second pass would double count.

  if (tables.has("subteam_calendar_events")) {
    const rows = await client.query<{ title: string; kind: string; total: number }>(
      `SELECT title, kind, count(*) OVER ()::int AS total
       FROM subteam_calendar_events
       WHERE org_id = $1::uuid AND starts_at >= $2::timestamptz AND starts_at <= now()
       ORDER BY starts_at DESC
       LIMIT ${LIST_LIMIT}`,
      [orgId, sinceIso],
    );
    digest.calendarEvents.count = rows.rows[0]?.total ?? 0;
    digest.calendarEvents.items = rows.rows.map((row) => ({
      title: clampExcerpt(row.title),
      kind: row.kind,
    }));
  }

  const incidentItems: DreamIncident[] = [];
  if (tables.has("incident_reports")) {
    const rows = await client.query<{ title: string; action: "opened" | "resolved" }>(
      `SELECT title,
              CASE WHEN created_at >= $2::timestamptz THEN 'opened' ELSE 'resolved' END AS action
       FROM incident_reports
       WHERE org_id = $1::uuid
         AND (created_at >= $2::timestamptz
              OR (status IN ('resolved','closed') AND updated_at >= $2::timestamptz))
       ORDER BY updated_at DESC
       LIMIT ${LIST_LIMIT}`,
      [orgId, sinceIso],
    );
    for (const row of rows.rows) {
      incidentItems.push({ title: clampExcerpt(row.title), kind: "safety_incident", action: row.action });
    }
  }
  if (tables.has("pit_repair_triage_reports")) {
    const rows = await client.query<{ title: string; action: "opened" | "resolved" }>(
      `SELECT title,
              CASE WHEN created_at >= $2::timestamptz THEN 'opened' ELSE 'resolved' END AS action
       FROM pit_repair_triage_reports
       WHERE org_id = $1::uuid
         AND (created_at >= $2::timestamptz
              OR (status = 'resolved' AND updated_at >= $2::timestamptz))
       ORDER BY updated_at DESC
       LIMIT ${LIST_LIMIT}`,
      [orgId, sinceIso],
    );
    for (const row of rows.rows) {
      incidentItems.push({ title: clampExcerpt(row.title), kind: "pit_repair", action: row.action });
    }
  }
  digest.incidents.items = incidentItems.slice(0, LIST_LIMIT);
  digest.incidents.openedCount = incidentItems.filter((item) => item.action === "opened").length;
  digest.incidents.resolvedCount = incidentItems.filter((item) => item.action === "resolved").length;

  if (tables.has("cad_jobs")) {
    const rows = await client.query<{ title: string; platform: string; status: string; total: number }>(
      `SELECT title, platform, status, count(*) OVER ()::int AS total
       FROM cad_jobs
       WHERE org_id = $1::uuid AND created_at >= $2::timestamptz
       ORDER BY created_at DESC
       LIMIT ${LIST_LIMIT}`,
      [orgId, sinceIso],
    );
    digest.cadJobs.count = rows.rows[0]?.total ?? 0;
    digest.cadJobs.items = rows.rows.map((row) => ({
      title: clampExcerpt(row.title),
      platform: row.platform,
      status: row.status,
    }));
  }

  // --- Shop hours: who worked and for how long (closed sessions only). -----
  if (tables.has("hour_logs")) {
    const totals = await client.query<{ sessions: number; hours: number }>(
      `SELECT count(*)::int AS sessions,
              COALESCE(sum(extract(epoch FROM (clock_out - clock_in))) / 3600.0, 0)::float8 AS hours
       FROM hour_logs
       WHERE org_id = $1::uuid AND clock_out IS NOT NULL AND clock_out >= $2::timestamptz`,
      [orgId, sinceIso],
    );
    digest.hours.sessions = totals.rows[0]?.sessions ?? 0;
    digest.hours.totalHours = totals.rows[0]?.hours ?? 0;
    if (digest.hours.sessions > 0) {
      const members = await client.query<{ name: string; hours: number }>(
        `SELECT u.name AS name,
                sum(extract(epoch FROM (h.clock_out - h.clock_in)))::float8 / 3600.0 AS hours
         FROM hour_logs h JOIN users u ON u.id = h.user_id
         WHERE h.org_id = $1::uuid AND h.clock_out IS NOT NULL AND h.clock_out >= $2::timestamptz
         GROUP BY u.name
         ORDER BY hours DESC
         LIMIT ${LIST_LIMIT}`,
        [orgId, sinceIso],
      );
      digest.hours.members = members.rows.map((row) => ({
        name: clampExcerpt(row.name),
        hours: row.hours,
      }));
    }
  }

  // --- "Call your shot": calls made and how close they landed. -------------
  if (tables.has("learning_predictions")) {
    const rows = await client.query<{
      calls: number;
      graded: number;
      spotOn: number;
      close: number;
      off: number;
      skipped: number;
    }>(
      `SELECT count(*)::int AS calls,
              count(*) FILTER (WHERE NOT skipped)::int AS graded,
              count(*) FILTER (WHERE closeness = 'spot-on')::int AS "spotOn",
              count(*) FILTER (WHERE closeness = 'close')::int AS "close",
              count(*) FILTER (WHERE closeness = 'off')::int AS "off",
              count(*) FILTER (WHERE skipped)::int AS skipped
       FROM learning_predictions
       WHERE org_id = $1::uuid AND created_at >= $2::timestamptz`,
      [orgId, sinceIso],
    );
    const tally = rows.rows[0];
    if (tally) digest.predictions = { ...tally };
  }

  // --- Match results posted for our team at the org's active event. --------
  if (tables.has("org_active_context") && tables.has("matches_ref")) {
    const context = await client.query<{ eventKey: string | null; teamNumber: number | null }>(
      `SELECT c.active_event_key AS "eventKey", o.team_number AS "teamNumber"
       FROM organizations o
       LEFT JOIN org_active_context c ON c.org_id = o.id
       WHERE o.id = $1::uuid`,
      [orgId],
    );
    const eventKey = context.rows[0]?.eventKey ?? null;
    const teamNumber = context.rows[0]?.teamNumber ?? null;
    // Both are required: without an active event there is no "our event day",
    // and without a team number no alliance can be identified as ours.
    if (eventKey && teamNumber) {
      const teamKey = `frc${teamNumber}`;
      const rows = await client.query<{
        matchLabel: string;
        onRed: boolean;
        redScore: number | null;
        blueScore: number | null;
        winningAlliance: string | null;
      }>(
        `SELECT (m.comp_level || m.match_number::text) AS "matchLabel",
                (m.red_alliance->'teamKeys' ? $2) AS "onRed",
                NULLIF(m.red_alliance->>'score', '')::float8 AS "redScore",
                NULLIF(m.blue_alliance->>'score', '')::float8 AS "blueScore",
                m.winning_alliance AS "winningAlliance"
         FROM matches_ref m
         WHERE m.event_key = $1
           AND (m.red_alliance->'teamKeys' ? $2 OR m.blue_alliance->'teamKeys' ? $2)
           AND COALESCE(m.post_result_time, m.actual_time) >= $3::timestamptz
         ORDER BY COALESCE(m.post_result_time, m.actual_time) DESC
         LIMIT ${LIST_LIMIT}`,
        [eventKey, teamKey, sinceIso],
      );
      const items: DreamMatchResult[] = rows.rows.map((row) => {
        const ourAlliance = row.onRed ? "red" : "blue";
        const ourScore = row.onRed ? row.redScore : row.blueScore;
        const theirScore = row.onRed ? row.blueScore : row.redScore;
        return {
          matchLabel: row.matchLabel,
          ourAlliance,
          ourScore,
          theirScore,
          outcome: matchOutcome({
            ourAlliance,
            winningAlliance: row.winningAlliance,
            ourScore,
            theirScore,
          }),
        };
      });
      digest.matchResults = {
        eventKey,
        items,
        wins: items.filter((item) => item.outcome === "win").length,
        losses: items.filter((item) => item.outcome === "loss").length,
        ties: items.filter((item) => item.outcome === "tie").length,
      };
    }
  }

  // --- Bug reports the team filed. -----------------------------------------
  if (tables.has("bug_reports")) {
    const rows = await client.query<{
      description: string;
      severity: string | null;
      area: string | null;
      total: number;
    }>(
      `SELECT description, severity, app_area AS area, count(*) OVER ()::int AS total
       FROM bug_reports
       WHERE org_id = $1::uuid AND created_at >= $2::timestamptz
       ORDER BY created_at DESC
       LIMIT ${LIST_LIMIT}`,
      [orgId, sinceIso],
    );
    digest.bugs.count = rows.rows[0]?.total ?? 0;
    digest.bugs.items = rows.rows.map((row) => ({
      summary: clampExcerpt(row.description),
      severity: row.severity,
      area: row.area,
    }));
  }

  // --- Funding deadlines that crossed into the 14-day window TODAY. --------
  // Equality (not a range) so a deadline is mentioned on exactly one night
  // instead of nagging in fourteen consecutive recaps.
  const grantItems: DreamGrantDeadline[] = [];
  if (tables.has("grant_opportunities")) {
    const rows = await client.query<{ name: string; funder: string | null; closesOn: string }>(
      `SELECT name, funder, deadline::text AS "closesOn"
       FROM grant_opportunities
       WHERE org_id = $1::uuid AND deadline = ($2::date + $3::int)
       ORDER BY name
       LIMIT ${LIST_LIMIT}`,
      [orgId, input.day, GRANT_DEADLINE_HORIZON_DAYS],
    );
    grantItems.push(
      ...rows.rows.map((row) => ({
        name: clampExcerpt(row.name),
        funder: row.funder ? clampExcerpt(row.funder) : null,
        closesOn: row.closesOn,
      })),
    );
  }
  if (tables.has("grant_calendar_opportunities") && tables.has("grant_calendar_watchlist")) {
    const rows = await client.query<{ name: string; funder: string | null; closesOn: string }>(
      `SELECT DISTINCT g.name, g.funder, g.closes_on::text AS "closesOn"
       FROM grant_calendar_watchlist w
       JOIN grant_calendar_opportunities g ON g.id = w.opportunity_id
       WHERE w.org_id = $1::uuid AND g.is_active = true
         AND g.closes_on = ($2::date + $3::int)
       ORDER BY g.name
       LIMIT ${LIST_LIMIT}`,
      [orgId, input.day, GRANT_DEADLINE_HORIZON_DAYS],
    );
    grantItems.push(
      ...rows.rows.map((row) => ({
        name: clampExcerpt(row.name),
        funder: row.funder ? clampExcerpt(row.funder) : null,
        closesOn: row.closesOn,
      })),
    );
  }
  digest.grantDeadlines.items = grantItems.slice(0, LIST_LIMIT);
  digest.grantDeadlines.count = grantItems.length;

  return digest;
}

type AiDreamResult = { text: string; tokensIn: number; tokensOut: number };

/**
 * Resolve the org's chat adapter and run the recap through the metered
 * billing path (feature=team_dream, attributed to the org's owner). ANY
 * failure — no key, decrypt error, billing cap, HTTP error — returns null so
 * the caller falls back to the deterministic digest. Never throws.
 */
async function tryAiDream(
  client: PoolClient,
  input: { orgId: string; day: string; prompt: string; feature?: string },
): Promise<{ result: AiDreamResult | null; errorClass: string | null }> {
  const feature = input.feature ?? "team_dream";
  try {
    const owner = await client.query<{ userId: string }>(
      `SELECT user_id AS "userId" FROM memberships
       WHERE org_id = $1::uuid
       ORDER BY CASE role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at
       LIMIT 1`,
      [input.orgId],
    );
    const ownerId = owner.rows[0]?.userId;
    if (!ownerId) return { result: null, errorClass: "NoOrgMembers" };

    // Real org toggle (default-on); tolerate a failed read without killing the dream.
    const promptCachingEnabled = await getOrgPromptCachingEnabled(client, input.orgId).catch(
      () => true,
    );
    // Honest feature tag: dreams are batch work, so they ride a paired subscription
    // bridge only when its owner opted into coverage='everything'.
    const adapter = await resolveOrgChatAdapter(client, {
      orgId: input.orgId,
      promptCachingEnabled,
      feature: "dreams",
      bridgeTransport: createBridgeTransport(),
    });

    await client.query("BEGIN");
    try {
      const completion = await meteredAI({
        client,
        orgId: input.orgId,
        userId: ownerId,
        feature,
        requestId: crypto.randomUUID(),
        estimatedCostUsd: 0,
        estimatedPromptTokens: Math.ceil(input.prompt.length / 4),
        estimatedCompletionTokens: 800,
        provider: adapter.provider,
        model: adapter.model,
        metadata: { day: input.day, path: "team_dream_cron", feature },
        invoke: async () => {
          const response = await adapter.complete({
            message: input.prompt,
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
      if (!text) return { result: null, errorClass: "EmptyCompletion" };
      return {
        result: {
          text,
          tokensIn: completion.promptTokens,
          tokensOut: completion.completionTokens,
        },
        errorClass: null,
      };
    } catch (error) {
      // meteredAI signals "commit the denial record, then fail" via CommitAndThrowError.
      if (error instanceof CommitAndThrowError) {
        await client.query("COMMIT").catch(() => {});
      } else {
        await client.query("ROLLBACK").catch(() => {});
      }
      throw error;
    }
  } catch (error) {
    return { result: null, errorClass: errorClassOf(error) };
  }
}

function errorClassOf(error: unknown): string {
  if (error instanceof CommitAndThrowError) return errorClassOf(error.publicError);
  if (error instanceof Error && error.name) return error.name.slice(0, ERROR_CLASS_MAX_CHARS);
  return "UnknownError";
}

type DreamKind = "daily" | "weekly";

async function deletePriorDreamMemory(
  client: PoolClient,
  orgId: string,
  day: string,
  kind: DreamKind,
): Promise<void> {
  // Ledger-driven: the run row for (org, day, kind) points at the memory it wrote.
  const prior = await client.query<{ memoryId: string | null }>(
    `SELECT memory_id AS "memoryId" FROM team_dream_runs
     WHERE org_id = $1::uuid AND day = $2::date AND kind = $3`,
    [orgId, day, kind],
  );
  const memoryId = prior.rows[0]?.memoryId;
  if (!memoryId) return;
  await client.query(
    `DELETE FROM team_memories WHERE id = $1::uuid AND org_id = $2::uuid AND source = 'dream'`,
    [memoryId, orgId],
  );
}

async function insertDreamMemory(
  client: PoolClient,
  input: {
    orgId: string;
    day: string;
    content: string;
    retentionDays: number;
    importance: number;
  },
): Promise<string> {
  // Mirrors AgentRepository.promoteMessage's INSERT column shape; dream rows
  // carry NULL thread/message/promoter (relaxed in 0446) and source='dream'.
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO team_memories
       (org_id, content, source_thread_id, source_message_id, promoted_by, importance, source, expires_at)
     VALUES ($1::uuid, $2, NULL, NULL, NULL, $3, 'dream',
             ($4::date + make_interval(days => $5::int)))
     RETURNING id`,
    [input.orgId, input.content, input.importance, input.day, input.retentionDays],
  );
  return inserted.rows[0]!.id;
}

async function recordRun(
  client: PoolClient,
  input: {
    orgId: string;
    day: string;
    kind: DreamKind;
    status: "ok" | "no_activity" | "no_ai_fallback" | "error";
    memoryId?: string | null;
    tokensIn?: number | null;
    tokensOut?: number | null;
    errorClass?: string | null;
    sourceCounts?: DreamSourceCounts | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO team_dream_runs
       (org_id, day, kind, status, memory_id, tokens_in, tokens_out, error_class, source_counts)
     VALUES ($1::uuid, $2::date, $3, $4, $5::uuid, $6, $7, $8, $9::jsonb)
     ON CONFLICT (org_id, day, kind) DO UPDATE SET
       ran_at = now(),
       status = EXCLUDED.status,
       memory_id = EXCLUDED.memory_id,
       tokens_in = EXCLUDED.tokens_in,
       tokens_out = EXCLUDED.tokens_out,
       error_class = EXCLUDED.error_class,
       source_counts = EXCLUDED.source_counts`,
    [
      input.orgId,
      input.day,
      input.kind,
      input.status,
      input.memoryId ?? null,
      input.tokensIn ?? null,
      input.tokensOut ?? null,
      input.errorClass ?? null,
      JSON.stringify(input.sourceCounts ?? {}),
    ],
  );
}

async function dreamOneOrg(
  client: PoolClient,
  org: DreamOrg,
  context: { day: string; sinceIso: string; tables: Set<SourceTable> },
): Promise<"ok" | "no_activity" | "no_ai_fallback"> {
  const digest = await gatherDreamDigest(client, {
    orgId: org.orgId,
    orgName: org.orgName,
    day: context.day,
    sinceIso: context.sinceIso,
    tables: context.tables,
  });

  // Re-runs replace the same day's memory: drop the previous one first.
  await deletePriorDreamMemory(client, org.orgId, context.day, "daily");

  if (!hasActivity(digest)) {
    // A day with no real activity writes NOTHING to team memory.
    await recordRun(client, {
      orgId: org.orgId,
      day: context.day,
      kind: "daily",
      status: "no_activity",
    });
    return "no_activity";
  }

  const prompt = assembleDreamPrompt(digest);
  const ai = await tryAiDream(client, { orgId: org.orgId, day: context.day, prompt });

  const status: "ok" | "no_ai_fallback" = ai.result ? "ok" : "no_ai_fallback";
  const content = ai.result
    ? `Team recap for ${context.day} — ${org.orgName}.\n${ai.result.text}`.slice(0, MEMORY_MAX_CHARS)
    : deterministicDigest(digest).slice(0, MEMORY_MAX_CHARS);

  const memoryId = await insertDreamMemory(client, {
    orgId: org.orgId,
    day: context.day,
    content,
    retentionDays: org.retentionDays,
    importance: 0.6,
  });
  await recordRun(client, {
    orgId: org.orgId,
    day: context.day,
    kind: "daily",
    status,
    memoryId,
    tokensIn: ai.result?.tokensIn ?? null,
    tokensOut: ai.result?.tokensOut ?? null,
    errorClass: ai.errorClass,
    sourceCounts: digestSourceCounts(digest),
  });
  return status;
}

/**
 * Saturday's extra pass: fold the week's DAILY dream rows into one week
 * summary. It reads the stored recaps — never the raw activity tables again —
 * so the week can only ever say what the nights already said. Fewer than
 * WEEK_MIN_DAYS recorded days means the week is skipped as `no_activity`.
 */
async function weeklyRollupForOrg(
  client: PoolClient,
  org: DreamOrg,
  context: { day: string },
): Promise<"ok" | "no_activity" | "no_ai_fallback"> {
  const window = weekWindow(context.day);

  const rows = await client.query<{
    day: string;
    content: string;
    sourceCounts: unknown;
  }>(
    `SELECT r.day::text AS day, m.content, r.source_counts AS "sourceCounts"
     FROM team_dream_runs r
     JOIN team_memories m ON m.id = r.memory_id AND m.org_id = r.org_id
     WHERE r.org_id = $1::uuid
       AND r.kind = 'daily'
       AND r.day >= $2::date AND r.day <= $3::date
       AND m.source = 'dream'
       AND m.disabled_at IS NULL
       -- Retention honesty: a daily recap the team's retention window has
       -- already aged out must not be re-consolidated into a fresh row that
       -- would quietly extend its life.
       AND (m.expires_at IS NULL OR m.expires_at > now())
       AND length(btrim(m.content)) > 0
     ORDER BY r.day`,
    [org.orgId, window.start, window.end],
  );

  const digest: WeekDigest = {
    orgName: org.orgName,
    weekStart: window.start,
    weekEnd: window.end,
    days: rows.rows.map((row) => ({ day: row.day, content: row.content })),
  };

  await deletePriorDreamMemory(client, org.orgId, context.day, "weekly");

  if (!hasWeekMaterial(digest)) {
    await recordRun(client, {
      orgId: org.orgId,
      day: context.day,
      kind: "weekly",
      status: "no_activity",
    });
    return "no_activity";
  }

  const prompt = assembleWeekPrompt(digest);
  const ai = await tryAiDream(client, {
    orgId: org.orgId,
    day: context.day,
    prompt,
    feature: "team_dream_week",
  });

  const status: "ok" | "no_ai_fallback" = ai.result ? "ok" : "no_ai_fallback";
  const content = ai.result
    ? `Week in review ${window.start} — ${window.end} — ${org.orgName}.\n${ai.result.text}`.slice(
        0,
        MEMORY_MAX_CHARS,
      )
    : deterministicWeek(digest).slice(0, MEMORY_MAX_CHARS);

  const memoryId = await insertDreamMemory(client, {
    orgId: org.orgId,
    day: context.day,
    content,
    retentionDays: org.retentionDays,
    // Slightly above a single night: a week summary is the more useful row to
    // keep when the per-prompt token budget forces a trim.
    importance: 0.7,
  });
  await recordRun(client, {
    orgId: org.orgId,
    day: context.day,
    kind: "weekly",
    status,
    memoryId,
    tokensIn: ai.result?.tokensIn ?? null,
    tokensOut: ai.result?.tokensOut ?? null,
    errorClass: ai.errorClass,
    sourceCounts: sumSourceCounts(rows.rows.map((row) => parseSourceCounts(row.sourceCounts))),
  });
  return status;
}

export async function runTeamDream(
  options: { orgId?: string; now?: Date } = {},
): Promise<TeamDreamRunSummary> {
  const now = options.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const sinceIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const weeklyDay = isWeeklyRollupDay(day);

  const summary: TeamDreamRunSummary = {
    processed: 0,
    ok: 0,
    noActivity: 0,
    fallback: 0,
    errors: 0,
    weeklyProcessed: 0,
    weeklyOk: 0,
    weeklySkipped: 0,
    weeklyErrors: 0,
  };
  const pool = workerPool();
  const client = await pool.connect();
  try {
    const tables = await listPresentTables(client);
    const orgs = await listEnabledOrgs(client, options.orgId);
    for (const org of orgs) {
      summary.processed += 1;
      try {
        const status = await dreamOneOrg(client, org, { day, sinceIso, tables });
        if (status === "ok") summary.ok += 1;
        else if (status === "no_activity") summary.noActivity += 1;
        else summary.fallback += 1;
      } catch (error) {
        summary.errors += 1;
        // Leave the failed transaction (if any) unwound before the next org.
        await client.query("ROLLBACK").catch(() => {});
        await recordRun(client, {
          orgId: org.orgId,
          day,
          kind: "daily",
          status: "error",
          errorClass: errorClassOf(error),
        }).catch(() => {});
        console.error(`team-dream: org run failed (${errorClassOf(error)})`);
      }

      // The week roll-up runs AFTER the night's own row so Saturday itself is
      // part of the week it summarises. A failed nightly run simply leaves one
      // fewer day of material.
      if (!weeklyDay) continue;
      summary.weeklyProcessed += 1;
      try {
        const status = await weeklyRollupForOrg(client, org, { day });
        if (status === "no_activity") summary.weeklySkipped += 1;
        else summary.weeklyOk += 1;
      } catch (error) {
        summary.weeklyErrors += 1;
        await client.query("ROLLBACK").catch(() => {});
        await recordRun(client, {
          orgId: org.orgId,
          day,
          kind: "weekly",
          status: "error",
          errorClass: errorClassOf(error),
        }).catch(() => {});
        console.error(`team-dream: weekly roll-up failed (${errorClassOf(error)})`);
      }
    }
    return summary;
  } finally {
    client.release();
    await pool.end();
  }
}
