import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import {
  buildAttendanceSummary,
  buildBlockers,
  buildHoursSummary,
  buildKnowledgeEdits,
  buildSubteamBriefs,
  classifyTaskMovement,
  defaultDigestDate,
  overallHeadline,
  windowForDate,
} from ".";
import type { StandupDigestNote, StandupDigestRun, StandupDigestSummary } from "./types";

export type StandupDigestSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type StandupDigestView =
  | {
      status: "setup_required";
      message: string;
      steps: StandupDigestSetupStep[];
      orgId: string | null;
      digestDate: string;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      digestDate: string;
      summary: StandupDigestSummary;
      latestRun: StandupDigestRun | null;
      notes: StandupDigestNote[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function isDigestDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

async function computeSummary(
  client: PoolClient,
  orgId: string,
  digestDate: string,
): Promise<StandupDigestSummary> {
  const { windowStart, windowEnd } = windowForDate(digestDate);

  const [hoursResult, movementResult, blockerResult, attendanceResult, knowledgeResult] = await Promise.all([
    client.query<{ userId: string; name: string; kind: string; hours: number }>(
      `SELECT h.user_id::text AS "userId", COALESCE(NULLIF(trim(u.name),''),u.email) AS name, h.kind,
              extract(epoch FROM (COALESCE(h.clock_out, now()) - h.clock_in)) / 3600.0 AS hours
       FROM hour_logs h JOIN users u ON u.id = h.user_id
       WHERE h.org_id = $1 AND h.clock_in >= $2::timestamptz AND h.clock_in < $3::timestamptz`,
      [orgId, windowStart, windowEnd],
    ),
    client.query<{
      id: string;
      title: string;
      subsystem: string;
      status: string;
      assignee: string | null;
      doneAt: string | null;
      createdAt: string;
      updatedAt: string;
    }>(
      `SELECT id, title, subsystem, status, assignee,
              done_at::text AS "doneAt", created_at::text AS "createdAt", updated_at::text AS "updatedAt"
       FROM build_tasks
       WHERE org_id = $1
         AND (
           (done_at >= $2::timestamptz AND done_at < $3::timestamptz) OR
           (created_at >= $2::timestamptz AND created_at < $3::timestamptz) OR
           (status = 'blocked' AND updated_at >= $2::timestamptz AND updated_at < $3::timestamptz)
         )
       ORDER BY updated_at DESC`,
      [orgId, windowStart, windowEnd],
    ),
    client.query<{
      id: string;
      title: string;
      subsystem: string;
      assignee: string | null;
      blockedReason: string | null;
      createdAt: string;
    }>(
      `SELECT id, title, subsystem, assignee, blocked_reason AS "blockedReason", created_at::text AS "createdAt"
       FROM build_tasks
       WHERE org_id = $1 AND status = 'blocked'
       ORDER BY updated_at DESC`,
      [orgId],
    ),
    client.query<{
      id: string;
      title: string;
      kind: string;
      occurredOn: string;
      attendeeCount: string | number;
      creditHours: string | number;
    }>(
      `SELECT e.id, e.title, e.kind, e.occurred_on::text AS "occurredOn", e.credit_hours AS "creditHours",
              count(en.id)::int AS "attendeeCount"
       FROM attendance_events e LEFT JOIN attendance_entries en ON en.event_id = e.id
       WHERE e.org_id = $1 AND e.occurred_on = $2::date
       GROUP BY e.id
       ORDER BY e.title`,
      [orgId, digestDate],
    ),
    client.query<{ id: string; title: string; updatedByName: string | null; updatedAt: string; created: boolean }>(
      `SELECT p.id, p.title, COALESCE(NULLIF(trim(uu.name),''),uu.email) AS "updatedByName",
              p.updated_at::text AS "updatedAt",
              (p.created_at >= $2::timestamptz AND p.created_at < $3::timestamptz) AS created
       FROM knowledge_pages p LEFT JOIN users uu ON uu.id = p.updated_by
       WHERE p.org_id = $1 AND p.updated_at >= $2::timestamptz AND p.updated_at < $3::timestamptz
       ORDER BY p.updated_at DESC`,
      [orgId, windowStart, windowEnd],
    ),
  ]);

  const hours = buildHoursSummary(
    hoursResult.rows.map((row) => ({ ...row, hours: Number(row.hours) || 0 })),
  );
  const taskMovement = classifyTaskMovement(movementResult.rows, windowStart, windowEnd);
  const blockers = buildBlockers(blockerResult.rows);
  const attendance = buildAttendanceSummary(
    attendanceResult.rows.map((row) => ({
      ...row,
      attendeeCount: Number(row.attendeeCount) || 0,
      creditHours: Number(row.creditHours) || 0,
    })),
  );
  const knowledgeEdits = buildKnowledgeEdits(knowledgeResult.rows);
  const subteamBriefs = buildSubteamBriefs(taskMovement, blockers);

  const summary: StandupDigestSummary = {
    digestDate,
    windowStart,
    windowEnd,
    hours,
    taskMovement,
    blockers,
    attendance,
    knowledgeEdits,
    subteamBriefs,
    headline: "",
  };
  summary.headline = overallHeadline(summary);
  return summary;
}

export async function computeStandupDigestView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; digestDate?: string | null },
): Promise<StandupDigestView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const digestDate = isDigestDate(input.digestDate) ? input.digestDate : defaultDigestDate();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to generate the morning standup digest.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      digestDate,
    };
  }

  const [summary, runResult, noteResult] = await Promise.all([
    computeSummary(client, org.orgId, digestDate),
    client.query<{ id: string; headline: string; createdAt: string; generatedByName: string | null }>(
      `SELECT r.id, r.headline, r.created_at::text AS "createdAt",
              COALESCE(NULLIF(trim(gu.name),''),gu.email) AS "generatedByName"
       FROM standup_digest_runs r LEFT JOIN users gu ON gu.id = r.generated_by
       WHERE r.org_id = $1 AND r.digest_date = $2::date
       ORDER BY r.created_at DESC LIMIT 1`,
      [org.orgId, digestDate],
    ),
    client.query<{ id: string; subteam: string; note: string; createdAt: string; createdByName: string | null }>(
      `SELECT n.id, n.subteam, n.note, n.created_at::text AS "createdAt",
              COALESCE(NULLIF(trim(cu.name),''),cu.email) AS "createdByName"
       FROM standup_digest_notes n LEFT JOIN users cu ON cu.id = n.created_by
       WHERE n.org_id = $1 AND n.digest_date = $2::date
       ORDER BY n.created_at DESC`,
      [org.orgId, digestDate],
    ),
  ]);

  const runRow = runResult.rows[0] ?? null;
  const latestRun: StandupDigestRun | null = runRow
    ? { id: runRow.id, digestDate, headline: runRow.headline, generatedByName: runRow.generatedByName, createdAt: runRow.createdAt }
    : null;

  const notes: StandupDigestNote[] = noteResult.rows.map((row) => ({
    id: row.id,
    digestDate,
    subteam: row.subteam,
    note: row.note,
    createdByName: row.createdByName,
    createdAt: row.createdAt,
  }));

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear: currentSeasonYear(),
    digestDate,
    summary,
    latestRun,
    notes,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

/**
 * Recomputes the digest for the given date and persists a snapshot + narrative headline.
 * The headline synthesis is deterministic (grounded entirely in the counted rows above, no
 * external model call) but still runs through the standard AI-usage metering path — matching
 * the local/deterministic metering pattern used by other zero-provider-cost computed briefs.
 */
export async function generateDigest(
  client: PoolClient,
  input: { orgId: string; userId: string; digestDate?: string | null },
): Promise<StandupDigestSummary> {
  const digestDate = isDigestDate(input.digestDate) ? input.digestDate : defaultDigestDate();
  const summary = await computeSummary(client, input.orgId, digestDate);

  const metered = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "standup_digest",
    requestId: `standup-digest-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      digestDate,
      note: "Deterministic standup-digest headline synthesis — no external model call",
    },
    invoke: async () => ({
      value: summary.headline,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-standup-digest-v1",
      provider: "vantage-local",
    }),
  });

  await client.query(
    `INSERT INTO standup_digest_runs (org_id, digest_date, season_year, summary, headline, generated_by)
     VALUES ($1,$2::date,$3,$4::jsonb,$5,$6)
     ON CONFLICT (org_id, digest_date) DO UPDATE SET
       season_year = EXCLUDED.season_year,
       summary = EXCLUDED.summary,
       headline = EXCLUDED.headline,
       generated_by = EXCLUDED.generated_by,
       created_at = now()`,
    [input.orgId, digestDate, currentSeasonYear(), JSON.stringify(summary), metered, input.userId],
  );

  return summary;
}

export async function addNote(
  client: PoolClient,
  input: { orgId: string; userId: string; digestDate: string; subteam: string; note: string },
): Promise<void> {
  await client.query(
    `INSERT INTO standup_digest_notes (org_id, digest_date, subteam, note, created_by)
     VALUES ($1,$2::date,$3,$4,$5)`,
    [input.orgId, input.digestDate, input.subteam, input.note, input.userId],
  );
}

export async function deleteNote(client: PoolClient, input: { orgId: string; noteId: string }): Promise<void> {
  await client.query(`DELETE FROM standup_digest_notes WHERE id = $1 AND org_id = $2`, [input.noteId, input.orgId]);
}
