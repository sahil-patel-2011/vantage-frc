/**
 * Postgres → Excel workbook sync.
 *
 * Postgres is the source of truth; the workbook is a copy that every sync REPLACES table by
 * table. That is what makes a sync idempotent: running it twice against unchanged data
 * leaves an identical workbook, and a sync that failed halfway is repaired by the next one.
 *
 * The sync is written against `WorkbookTarget`, not against Graph. The Graph implementation
 * lives in workbook-target.ts; the unit tests drive the same code with an in-memory target.
 *
 * Request-path code: every query runs on the caller's `withRls` client (never
 * @vantage/db/admin), so a sync can only ever read the caller's own team's rows.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { contentHash } from "../mirror/mirror-hash";
import { listPickList } from "../picklist";
import { describeGraphError, isGraphError } from "./graph";
import {
  type BuiltTable,
  type CellValue,
  type MatchSourceRow,
  type PickListSourceRow,
  type ScoutSourceRow,
  type TableSpec,
  type TeamSourceRow,
  type WorkbookEntity,
  type WorkbookSource,
  buildWorkbookTables,
} from "./workbook-schema";

// ------------------------------------------------------------------ the target interface

export interface WorkbookTarget {
  /** Make sure the sheet and the table with exactly these header columns exist. */
  ensureTable(spec: TableSpec): Promise<void>;
  /** Replace every data row of the table with `rows` (in order). */
  replaceRows(spec: TableSpec, rows: CellValue[][]): Promise<void>;
  /** Release anything held open (a workbook session). Must not throw. */
  close(): Promise<void>;
  /**
   * Optional: send everything ensureTable/replaceRows recorded. A target that batches its
   * writes (Google Sheets, to stay far inside its per-minute quota) does its I/O here; one
   * that writes as it goes (Excel) leaves it out. Throwing fails every table of the copy.
   */
  flush?(): Promise<void>;
}

// ------------------------------------------------------------------ reading Postgres

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;
const iso = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', ${ISO})`;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function teamKeys(alliance: unknown): string[] {
  if (!alliance || typeof alliance !== "object") return [];
  const keys = (alliance as { teamKeys?: unknown; team_keys?: unknown }).teamKeys ?? (alliance as { team_keys?: unknown }).team_keys;
  return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [];
}

function score(alliance: unknown): number | null {
  if (!alliance || typeof alliance !== "object") return null;
  const value = num((alliance as { score?: unknown }).score);
  // TBA reports -1 for "not played yet": that is not a score.
  return value === null || value < 0 ? null : value;
}

/**
 * Everything the workbook shows, scoped to the team's active event when one is set
 * (org_active_context). With no active event, Teams and Matches are empty — there is no
 * roster to show — and scouting covers every event the team has scouted.
 */
export async function loadWorkbookSource(client: PoolClient, orgId: string): Promise<WorkbookSource> {
  const org = (
    await client.query<{ name: string; teamNumber: number | null; activeEventKey: string | null }>(
      `SELECT o.name, o.team_number AS "teamNumber", c.active_event_key AS "activeEventKey"
         FROM organizations o
         LEFT JOIN org_active_context c ON c.org_id = o.id
        WHERE o.id = $1::uuid`,
      [orgId],
    )
  ).rows[0];
  if (!org) throw new Error("Team not found.");
  const eventKey = org.activeEventKey?.trim() || null;

  const teams: TeamSourceRow[] = [];
  const matches: MatchSourceRow[] = [];
  if (eventKey) {
    const teamRows = await client.query(
      `WITH roster AS (
         SELECT team_key FROM team_event_metrics WHERE event_key = $1::text
         UNION
         SELECT jsonb_array_elements_text(m.red_alliance->'teamKeys')
           FROM matches_ref m
          WHERE m.event_key = $1::text AND jsonb_typeof(m.red_alliance->'teamKeys') = 'array'
         UNION
         SELECT jsonb_array_elements_text(m.blue_alliance->'teamKeys')
           FROM matches_ref m
          WHERE m.event_key = $1::text AND jsonb_typeof(m.blue_alliance->'teamKeys') = 'array'
       ),
       metrics AS (
         SELECT team_key,
                (array_agg(epa_total ORDER BY synced_at DESC) FILTER (WHERE epa_total IS NOT NULL))[1] AS epa_total,
                (array_agg(epa_auto ORDER BY synced_at DESC) FILTER (WHERE epa_auto IS NOT NULL))[1] AS epa_auto,
                (array_agg(epa_teleop ORDER BY synced_at DESC) FILTER (WHERE epa_teleop IS NOT NULL))[1] AS epa_teleop,
                (array_agg(epa_endgame ORDER BY synced_at DESC) FILTER (WHERE epa_endgame IS NOT NULL))[1] AS epa_endgame,
                (array_agg(opr ORDER BY synced_at DESC) FILTER (WHERE opr IS NOT NULL))[1] AS opr,
                (array_agg(dpr ORDER BY synced_at DESC) FILTER (WHERE dpr IS NOT NULL))[1] AS dpr,
                (array_agg(ccwm ORDER BY synced_at DESC) FILTER (WHERE ccwm IS NOT NULL))[1] AS ccwm,
                (array_agg(rank ORDER BY synced_at DESC) FILTER (WHERE rank IS NOT NULL))[1] AS rank,
                (array_agg(wins ORDER BY synced_at DESC) FILTER (WHERE wins IS NOT NULL))[1] AS wins,
                (array_agg(losses ORDER BY synced_at DESC) FILTER (WHERE losses IS NOT NULL))[1] AS losses,
                (array_agg(ties ORDER BY synced_at DESC) FILTER (WHERE ties IS NOT NULL))[1] AS ties,
                string_agg(DISTINCT source, '+' ORDER BY source) AS sources,
                max(synced_at) AS synced_at
           FROM team_event_metrics
          WHERE event_key = $1::text
          GROUP BY team_key
       )
       SELECT r.team_key AS "teamKey", t.team_number AS "teamNumber", t.nickname, t.name, t.city,
              t.state_prov AS "stateProv", t.country, t.rookie_year AS "rookieYear",
              m.epa_total AS "epaTotal", m.epa_auto AS "epaAuto", m.epa_teleop AS "epaTeleop",
              m.epa_endgame AS "epaEndgame", m.opr, m.dpr, m.ccwm, m.rank, m.wins, m.losses, m.ties,
              m.sources AS "metricsSource",
              ${iso("COALESCE(m.synced_at, t.synced_at)")} AS "updatedAt"
         FROM roster r
         LEFT JOIN teams_ref t ON t.team_key = r.team_key
         LEFT JOIN metrics m ON m.team_key = r.team_key`,
      [eventKey],
    );
    for (const row of teamRows.rows as Array<Record<string, unknown>>) {
      teams.push({
        teamKey: String(row.teamKey),
        teamNumber: num(row.teamNumber),
        nickname: (row.nickname as string | null) ?? null,
        name: (row.name as string | null) ?? null,
        city: (row.city as string | null) ?? null,
        stateProv: (row.stateProv as string | null) ?? null,
        country: (row.country as string | null) ?? null,
        rookieYear: num(row.rookieYear),
        epaTotal: num(row.epaTotal),
        epaAuto: num(row.epaAuto),
        epaTeleop: num(row.epaTeleop),
        epaEndgame: num(row.epaEndgame),
        opr: num(row.opr),
        dpr: num(row.dpr),
        ccwm: num(row.ccwm),
        rank: num(row.rank),
        wins: num(row.wins),
        losses: num(row.losses),
        ties: num(row.ties),
        metricsSource: (row.metricsSource as string | null) ?? null,
        updatedAt: (row.updatedAt as string | null) ?? null,
      });
    }

    const matchRows = await client.query(
      `SELECT match_key AS "matchKey", event_key AS "eventKey", comp_level AS "compLevel",
              set_number AS "setNumber", match_number AS "matchNumber",
              red_alliance AS "red", blue_alliance AS "blue", winning_alliance AS "winningAlliance",
              ${iso("event_time")} AS "scheduledTime", ${iso("actual_time")} AS "actualTime",
              COALESCE(placeholder, false) AS placeholder, ${iso("synced_at")} AS "updatedAt"
         FROM matches_ref
        WHERE event_key = $1::text`,
      [eventKey],
    );
    for (const row of matchRows.rows as Array<Record<string, unknown>>) {
      matches.push({
        matchKey: String(row.matchKey),
        eventKey: String(row.eventKey),
        compLevel: String(row.compLevel ?? ""),
        setNumber: num(row.setNumber),
        matchNumber: num(row.matchNumber),
        red: teamKeys(row.red),
        blue: teamKeys(row.blue),
        redScore: score(row.red),
        blueScore: score(row.blue),
        winningAlliance: (row.winningAlliance as string | null) || null,
        scheduledTime: (row.scheduledTime as string | null) ?? null,
        actualTime: (row.actualTime as string | null) ?? null,
        placeholder: Boolean(row.placeholder),
        updatedAt: (row.updatedAt as string | null) ?? null,
      });
    }
  }

  const scoutColumns = `e.id::text AS id, e.event_key AS "eventKey", e.team_key AS "teamKey",
              u.name AS "scoutName", e.confidence::text AS confidence, e.source::text AS source,
              ${iso("e.created_at")} AS "createdAt", ${iso("e.updated_at")} AS "updatedAt", e.payload`;
  const matchScouting = (
    await client.query<ScoutSourceRow>(
      `SELECT ${scoutColumns}, e.match_key AS "matchKey"
         FROM match_scout_entries e
         LEFT JOIN users u ON u.id = e.scout_user_id
        WHERE e.org_id = $1::uuid AND ($2::text IS NULL OR e.event_key = $2::text)
        ORDER BY e.event_key, e.match_key, e.team_key, e.created_at, e.id
        LIMIT 50000`,
      [orgId, eventKey],
    )
  ).rows;
  const pitScouting = (
    await client.query<ScoutSourceRow>(
      `SELECT ${scoutColumns}
         FROM pit_scout_entries e
         LEFT JOIN users u ON u.id = e.scout_user_id
        WHERE e.org_id = $1::uuid AND ($2::text IS NULL OR e.event_key = $2::text)
        ORDER BY e.event_key, e.team_key, e.created_at, e.id
        LIMIT 50000`,
      [orgId, eventKey],
    )
  ).rows;

  // THE pick-list read (lib/picklist/store.ts): the most recent list for the active event.
  const snapshot = await listPickList(client, { orgId, eventKey });
  const pickList: PickListSourceRow[] = snapshot
    ? snapshot.entries.map((entry) => ({
        id: entry.id,
        pickListId: snapshot.list.id,
        listName: snapshot.list.name,
        listStatus: snapshot.list.status,
        listSource: snapshot.list.source,
        eventKey: snapshot.list.eventKey,
        rank: entry.rank,
        teamKey: entry.teamKey,
        teamNumber: entry.teamNumber,
        nickname: entry.nickname,
        bucket: entry.bucket,
        tier: entry.tier,
        notes: entry.notes,
        weightedScore: entry.weightedScore,
        voteCount: entry.votes.length,
        draftedAllianceSeed: entry.draftedAllianceSeed,
        draftedPickSlot: entry.draftedPickSlot,
        updatedByName: entry.updatedByName,
        updatedAt: normalizeTimestamp(entry.updatedAt),
      }))
    : [];

  return {
    orgName: org.name,
    teamNumber: num(org.teamNumber),
    activeEventKey: eventKey,
    teams,
    matches,
    matchScouting,
    pitScouting,
    pickList,
  };
}

/** Postgres `timestamptz::text` ("2026-09-22 10:00:00.123+00") → ISO UTC, second precision. */
export function normalizeTimestamp(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value.includes("T") ? value : value.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ------------------------------------------------------------------ writing the workbook

export type TableOutcome = { entity: WorkbookEntity; rows: number; ok: boolean; error?: string };

/**
 * Write each table in order. One table failing does not stop the others — except when
 * Microsoft says the sign-in is gone, where every later call would fail the same way.
 */
export async function writeWorkbookTables(target: WorkbookTarget, tables: BuiltTable[]): Promise<TableOutcome[]> {
  const outcomes: TableOutcome[] = [];
  let fatal: string | null = null;
  for (const table of tables) {
    if (fatal) {
      outcomes.push({ entity: table.spec.entity, rows: 0, ok: false, error: fatal });
      continue;
    }
    try {
      await target.ensureTable(table.spec);
      await target.replaceRows(table.spec, table.rows);
      outcomes.push({ entity: table.spec.entity, rows: table.rows.length, ok: true });
    } catch (error) {
      const message = describeGraphError(error);
      outcomes.push({ entity: table.spec.entity, rows: 0, ok: false, error: message });
      if (isGraphError(error) && error.kind === "auth_expired") fatal = message;
    }
  }
  return outcomes;
}

export type SyncStatus = "succeeded" | "partial" | "failed";

export function summarizeOutcomes(outcomes: TableOutcome[]): {
  status: SyncStatus;
  rowsWritten: number;
  tablesWritten: Record<string, { rows: number; ok: boolean; error?: string }>;
  error: string | null;
} {
  const failed = outcomes.filter((outcome) => !outcome.ok);
  const status: SyncStatus =
    failed.length === 0 ? "succeeded" : failed.length === outcomes.length ? "failed" : "partial";
  const tablesWritten: Record<string, { rows: number; ok: boolean; error?: string }> = {};
  for (const outcome of outcomes) {
    tablesWritten[outcome.entity] = outcome.ok
      ? { rows: outcome.rows, ok: true }
      : { rows: 0, ok: false, error: outcome.error };
  }
  let error: string | null = null;
  if (status === "partial") {
    error = `Some sheets did not update: ${failed.map((outcome) => outcome.entity).join(", ")}. ${failed[0]?.error ?? ""}`.trim();
  } else if (status === "failed") {
    error = failed[0]?.error ?? "The sync failed.";
  }
  return {
    status,
    rowsWritten: outcomes.reduce((sum, outcome) => sum + (outcome.ok ? outcome.rows : 0), 0),
    tablesWritten,
    error,
  };
}

// ------------------------------------------------------------------ the orchestrator

export type SyncResult =
  | {
      status: SyncStatus;
      runId: string;
      rowsWritten: number;
      tablesWritten: Record<string, { rows: number; ok: boolean; error?: string }>;
      error: string | null;
    }
  | { status: "busy" };

export type SyncOptions = {
  /** Opens the workbook (a Graph session in production, in-memory in tests). */
  openTarget: () => Promise<WorkbookTarget>;
  userId?: string | null;
  now?: () => Date;
  attempt?: number;
};

/**
 * Read this team's data, write it to the workbook, record the run.
 *
 * Runs inside the caller's single withRls transaction. A transaction-scoped advisory lock
 * keyed on the team makes two simultaneous "Sync now" presses safe: the second returns
 * `busy` instead of interleaving writes into the same workbook (which Microsoft's Excel
 * guidance warns causes throttling and merge conflicts).
 */
export async function syncOrgWorkbook(client: PoolClient, orgId: string, options: SyncOptions): Promise<SyncResult> {
  const now = options.now ?? (() => new Date());
  const locked = (
    await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock(hashtextextended('microsoft-workbook-sync:' || $1::text, 0)) AS locked`,
      [orgId],
    )
  ).rows[0]?.locked;
  if (!locked) return { status: "busy" };

  const run = (
    await client.query<{ id: string }>(
      `INSERT INTO workbook_sync_runs (org_id, status, attempt, started_by, started_at)
       VALUES ($1::uuid, 'running', $2::int, $3::uuid, $4::timestamptz)
       RETURNING id`,
      [orgId, Math.max(1, options.attempt ?? 1), options.userId ?? null, now().toISOString()],
    )
  ).rows[0]!;

  // A failure reading Postgres propagates: the transaction is aborted and withRls rolls the
  // run row back with it. Everything Microsoft-side is caught and recorded below.
  const source = await loadWorkbookSource(client, orgId);
  const tables = buildWorkbookTables(source, now());
  let outcomes: TableOutcome[];
  let target: WorkbookTarget | null = null;
  try {
    target = await options.openTarget();
    outcomes = await writeWorkbookTables(target, tables);
  } catch (error) {
    const message = describeGraphError(error);
    outcomes = tables.map((table) => ({ entity: table.spec.entity, rows: 0, ok: false, error: message }));
  } finally {
    await target?.close().catch(() => undefined);
  }

  const summary = summarizeOutcomes(outcomes);
  const finishedAt = now().toISOString();
  await client.query(
    `UPDATE workbook_sync_runs
        SET status = $2::text, finished_at = $3::timestamptz, tables_written = $4::jsonb,
            rows_written = $5::int, error = $6::text
      WHERE id = $1::uuid AND org_id = $7::uuid`,
    [run.id, summary.status, finishedAt, JSON.stringify(summary.tablesWritten), summary.rowsWritten, summary.error?.slice(0, 2000) ?? null, orgId],
  );
  if (summary.status === "succeeded") {
    // The same content hash the Google+Excel mirror stamps (lib/mirror/mirror-hash.ts), so an
    // Excel-only sync never leaves the mirror card claiming the copies match when they do not.
    await client.query(
      `UPDATE org_microsoft_connections
          SET last_sync_at = $2::timestamptz, last_sync_hash = $3::text, last_error = NULL, last_error_at = NULL,
              throttled_until = NULL, updated_at = now()
        WHERE org_id = $1::uuid`,
      [orgId, finishedAt, contentHash(tables)],
    );
  } else {
    await client.query(
      `UPDATE org_microsoft_connections
          SET last_sync_at = CASE WHEN $3::text = 'partial' THEN $2::timestamptz ELSE last_sync_at END,
              last_error = $4::text, last_error_at = $2::timestamptz, updated_at = now()
        WHERE org_id = $1::uuid`,
      [orgId, finishedAt, summary.status, (summary.error ?? "The sync failed.").slice(0, 500)],
    );
  }
  return { ...summary, runId: run.id };
}
