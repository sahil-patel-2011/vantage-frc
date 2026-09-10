import type { PoolClient } from "@neondatabase/serverless";
import { aggregateScoutStats, computeEntryAccuracy, summarizeScoutAccuracy } from ".";
import type { ScoutAccuracyEntry, ScoutAccuracyScoutStat, ScoutAccuracySnapshotMeta, ScoutAccuracySummary } from "./types";
import { resolveScoutOrg } from "../scout-org-access";
import { scoutAccuracySetupSteps, type ScoutAccuracySetupStep } from "./scout-accuracy-related";

export type { ScoutAccuracySetupStep };

export type ScoutAccuracyView =
  | {
      status: "setup_required";
      message: string;
      steps: ScoutAccuracySetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      eventKey: string | null;
      events: string[];
      stats: ScoutAccuracyScoutStat[];
      entries: ScoutAccuracyEntry[];
      summary: ScoutAccuracySummary;
      lastSnapshot: ScoutAccuracySnapshotMeta | null;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
) {
  return resolveScoutOrg(client, userId, requestedOrg);
}

type AllianceJson = { team_keys?: string[] } | string[] | null;

type EntryRow = {
  entryId: string;
  eventKey: string;
  matchKey: string;
  teamKey: string;
  teamNumber: number | null;
  scoutUserId: string;
  scoutName: string | null;
  payload: Record<string, unknown> | null;
  redAlliance: AllianceJson;
  blueAlliance: AllianceJson;
  scoreBreakdown: Record<string, unknown> | null;
};

function toDisplayName(name: string | null, scoutUserId: string): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : `Scout ${scoutUserId.slice(0, 8)}`;
}

export async function computeScoutAccuracyView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; eventKey?: string | null },
): Promise<ScoutAccuracyView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to score scout accuracy against official results.",
      steps: scoutAccuracySetupSteps(null),
      orgId: null,
    };
  }

  const eventsResult = await client.query<{ eventKey: string }>(
    `SELECT DISTINCT event_key AS "eventKey" FROM match_scout_entries WHERE org_id = $1 ORDER BY event_key DESC`,
    [org.orgId],
  );
  const events = eventsResult.rows.map((r) => r.eventKey);
  const eventKey = input.eventKey && events.includes(input.eventKey) ? input.eventKey : events[0] ?? null;

  if (!eventKey) {
    return {
      status: "live",
      orgId: org.orgId,
      teamNumber: org.teamNumber,
      eventKey: null,
      events,
      stats: [],
      entries: [],
      summary: summarizeScoutAccuracy([], []),
      lastSnapshot: null,
      computedAt: new Date().toISOString(),
    };
  }

  const [entryResult, promotionResult, snapshotResult] = await Promise.all([
    client.query<EntryRow>(
      `SELECT mse.id AS "entryId", mse.event_key AS "eventKey", mse.match_key AS "matchKey",
              mse.team_key AS "teamKey", t.team_number AS "teamNumber", mse.scout_user_id AS "scoutUserId",
              u.name AS "scoutName", mse.payload AS "payload",
              m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance", m.score_breakdown AS "scoreBreakdown"
       FROM match_scout_entries mse
       JOIN matches_ref m ON m.match_key = mse.match_key
       JOIN teams_ref t ON t.team_key = mse.team_key
       LEFT JOIN users u ON u.id = mse.scout_user_id
       WHERE mse.org_id = $1 AND mse.event_key = $2
       ORDER BY mse.synced_at DESC
       LIMIT 400`,
      [org.orgId, eventKey],
    ),
    client.query<{ scoutUserId: string }>(
      `SELECT scout_user_id AS "scoutUserId" FROM scout_accuracy_promotions
       WHERE org_id = $1 AND event_key = $2 AND promoted = true`,
      [org.orgId, eventKey],
    ),
    client.query<{
      id: string;
      eventKey: string;
      seasonYear: number;
      entriesScored: number;
      scoutsScored: number;
      avgAccuracyScore: number;
      computedAt: string;
    }>(
      `SELECT id, event_key AS "eventKey", season_year AS "seasonYear", entries_scored AS "entriesScored",
              scouts_scored AS "scoutsScored", avg_accuracy_score AS "avgAccuracyScore", computed_at::text AS "computedAt"
       FROM scout_accuracy_snapshots
       WHERE org_id = $1 AND event_key = $2
       ORDER BY computed_at DESC
       LIMIT 1`,
      [org.orgId, eventKey],
    ),
  ]);

  const entries = entryResult.rows.map((row) =>
    computeEntryAccuracy({
      matchScoutEntryId: row.entryId,
      eventKey: row.eventKey,
      matchKey: row.matchKey,
      teamKey: row.teamKey,
      teamNumber: row.teamNumber,
      scoutUserId: row.scoutUserId,
      scoutName: toDisplayName(row.scoutName, row.scoutUserId),
      payload: row.payload,
      scoreBreakdown: row.scoreBreakdown,
      redAlliance: row.redAlliance,
      blueAlliance: row.blueAlliance,
    }),
  );

  const promotedIds = new Set(promotionResult.rows.map((r) => r.scoutUserId));
  const stats = aggregateScoutStats(entries, promotedIds);
  const summary = summarizeScoutAccuracy(entries, stats);
  const snapshotRow = snapshotResult.rows[0];
  const lastSnapshot: ScoutAccuracySnapshotMeta | null = snapshotRow
    ? {
        id: snapshotRow.id,
        eventKey: snapshotRow.eventKey,
        seasonYear: snapshotRow.seasonYear,
        entriesScored: Number(snapshotRow.entriesScored) || 0,
        scoutsScored: Number(snapshotRow.scoutsScored) || 0,
        avgAccuracyScore: Number(snapshotRow.avgAccuracyScore) || 0,
        computedAt: snapshotRow.computedAt,
      }
    : null;

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    eventKey,
    events,
    stats,
    entries,
    summary,
    lastSnapshot,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

/** Persists the current live-computed leaderboard as a snapshot — the record a post-event cron writes. */
export async function recordScoutAccuracySnapshot(
  client: PoolClient,
  input: { orgId: string; userId: string; eventKey: string; seasonYear: number },
): Promise<ScoutAccuracyView> {
  const view = await computeScoutAccuracyView(client, { userId: input.userId, requestedOrg: input.orgId, eventKey: input.eventKey });
  if (view.status !== "live") return view;

  await client.query(
    `INSERT INTO scout_accuracy_snapshots (
       org_id, event_key, season_year, entries_scored, scouts_scored, avg_accuracy_score, scores, computed_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [
      input.orgId,
      input.eventKey,
      input.seasonYear,
      view.summary.totalEntries,
      view.summary.totalScouts,
      view.summary.avgAccuracyScore,
      JSON.stringify(view.stats),
      input.userId,
    ],
  );

  return computeScoutAccuracyView(client, { userId: input.userId, requestedOrg: input.orgId, eventKey: input.eventKey });
}

/** Confirms (or revokes) a scout's promotion into the pick-desk rotation for an event. */
export async function setScoutAccuracyPromotion(
  client: PoolClient,
  input: { orgId: string; userId: string; eventKey: string; scoutUserId: string; promoted: boolean; note: string | null },
): Promise<ScoutAccuracyView> {
  await client.query(
    `INSERT INTO scout_accuracy_promotions (org_id, event_key, scout_user_id, promoted, note, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (org_id, event_key, scout_user_id) DO UPDATE SET
       promoted = EXCLUDED.promoted,
       note = EXCLUDED.note,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [input.orgId, input.eventKey, input.scoutUserId, input.promoted, input.note, input.userId],
  );

  return computeScoutAccuracyView(client, { userId: input.userId, requestedOrg: input.orgId, eventKey: input.eventKey });
}
