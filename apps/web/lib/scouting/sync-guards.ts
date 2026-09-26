import type { SyncEntry } from "@vantage/scouting";

/**
 * Checks the sync route runs on each entry before the repository files it.
 *
 * 1. One report per scout per robot per match. A scout who reopened a robot they had already
 *    scouted (the phone forgot the old report, or a second phone) got a fresh id, and Save made
 *    a second report: the robot's averages counted that match twice and the disagreement check
 *    compared the scout with themself. A new id for a robot this scout already has is filed as
 *    an edit of that report.
 * 2. An id already filed for one robot never overwrites another. A QR row from another app, with
 *    no id of its own, used to get `qr-0-<event>-<team>`; the next scan of the same team in a
 *    different match reused it and put that match's numbers on the first match's report.
 *
 * Plain parameterized SQL through the request's withRls client; nothing here bypasses RLS.
 */

type Queryable = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
};

type StoredRow = {
  id: string;
  eventKey: string;
  matchKey: string | null;
  teamKey: string;
  scoutUserId: string;
  clientId: string | null;
};

export type SyncTarget =
  /** File it as sent. */
  | { kind: "as-sent"; entry: SyncEntry }
  /** File it under the id of the report this scout already has for the robot. */
  | { kind: "existing-report"; entry: SyncEntry }
  /** Refuse, with words a scout can act on. */
  | { kind: "refuse"; reason: string };

export const OTHER_ROBOT_REASON =
  "This entry's id already belongs to another robot's report, so it was not saved over it. Discard it and scout the robot again.";
export const OTHER_SCOUT_REASON = "This entry's id belongs to a teammate's report. Discard it and scout the robot again.";

/** A placeholder hash: never equal to a real one, so the next sync of the entry updates the row. */
const ADOPTED_HASH = "adopted-without-receipt";

function sameRobot(row: StoredRow, entry: SyncEntry): boolean {
  if (row.eventKey !== entry.eventKey || row.teamKey !== entry.teamKey) return false;
  return entry.type === "pit" ? true : row.matchKey === (entry.matchKey ?? null);
}

async function storedRow(client: Queryable, orgId: string, type: "match" | "pit", where: string, params: unknown[]) {
  const table = type === "match" ? "match_scout_entries" : "pit_scout_entries";
  const matchKey = type === "match" ? "match_key" : "NULL::text";
  const result = await client.query<StoredRow>(
    `SELECT id::text AS id, event_key AS "eventKey", ${matchKey} AS "matchKey", team_key AS "teamKey",
            scout_user_id::text AS "scoutUserId", client_id AS "clientId"
     FROM ${table}
     WHERE org_id = $1::uuid AND ${where}
     ORDER BY updated_at DESC
     LIMIT 1`,
    [orgId, ...params],
  );
  return result.rows[0] ?? null;
}

async function writeReceipt(client: Queryable, orgId: string, clientId: string, type: "match" | "pit", entryId: string) {
  await client.query(
    `INSERT INTO scout_sync_receipts (org_id, client_id, entry_type, server_entry_id, payload_hash)
     VALUES ($1::uuid, $2, $3::scout_schema_type, $4::uuid, $5)
     ON CONFLICT (org_id, client_id) DO NOTHING`,
    [orgId, clientId, type, entryId, ADOPTED_HASH],
  );
}

export async function resolveSyncTarget(
  client: Queryable,
  input: { orgId: string; userId: string; entry: SyncEntry },
): Promise<SyncTarget> {
  const { orgId, userId, entry } = input;
  if (!entry?.clientId || (entry.type !== "match" && entry.type !== "pit")) return { kind: "as-sent", entry };

  const receipt = await client.query<{ entryType: "match" | "pit"; serverEntryId: string }>(
    `SELECT entry_type::text AS "entryType", server_entry_id::text AS "serverEntryId"
     FROM scout_sync_receipts WHERE org_id = $1::uuid AND client_id = $2`,
    [orgId, entry.clientId],
  );
  const filed = receipt.rows[0];
  if (filed) {
    if (filed.entryType !== entry.type) return { kind: "refuse", reason: OTHER_ROBOT_REASON };
    const row = await storedRow(client, orgId, filed.entryType, "id = $2::uuid", [filed.serverEntryId]);
    if (row && !sameRobot(row, entry)) return { kind: "refuse", reason: OTHER_ROBOT_REASON };
    return { kind: "as-sent", entry };
  }

  // A report filed without a receipt (imported, or seeded) that already has this id.
  const byId = await storedRow(client, orgId, entry.type, "client_id = $2", [entry.clientId]);
  if (byId) {
    if (byId.scoutUserId !== userId) return { kind: "refuse", reason: OTHER_SCOUT_REASON };
    if (!sameRobot(byId, entry)) return { kind: "refuse", reason: OTHER_ROBOT_REASON };
    await writeReceipt(client, orgId, entry.clientId, entry.type, byId.id);
    return { kind: "as-sent", entry };
  }

  if (entry.type !== "match" || !entry.matchKey) return { kind: "as-sent", entry };
  const mine = await storedRow(
    client,
    orgId,
    "match",
    "event_key = $2 AND match_key = $3 AND team_key = $4 AND scout_user_id = $5::uuid AND client_id IS NOT NULL",
    [entry.eventKey, entry.matchKey, entry.teamKey, userId],
  );
  if (!mine?.clientId) return { kind: "as-sent", entry };
  await writeReceipt(client, orgId, mine.clientId, "match", mine.id);
  return { kind: "existing-report", entry: { ...entry, clientId: mine.clientId } };
}

/**
 * Database errors that say "try again", not "this entry is wrong": a lost race, a deadlock, a
 * timeout, a dropped connection. The entry stays queued on the phone instead of being set aside.
 */
export function isTransientDbError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== "string") return false;
  return code === "40001" || code === "40P01" || code === "57014" || code === "55P03" || code.startsWith("08");
}

/** A foreign key failed: the match or team is not in the event's reference data yet. */
export function isMissingReferenceError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23503";
}

export const MISSING_REFERENCE_REASON =
  "This match isn't on the event schedule yet. Tap Retry once the schedule is posted.";
