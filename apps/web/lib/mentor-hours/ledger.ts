/**
 * Mentor / parent-volunteer hours ledger.
 *
 * Adult volunteer time lives in `mentor_hours_entries` (migration 0281). That is a
 * different table from student `hour_logs` (the kiosk / My Hours clock). This module
 * is the only SQL this feature runs against the ledger: reads, inserts, and deletes
 * all target `mentor_hours_entries`. Student sessions are never read, copied, or
 * used to invent a mentor total.
 *
 * An org with no mentor_hours_entries rows is empty — zero is a real zero.
 */

import type { PoolClient } from "@neondatabase/serverless";
import type { MentorHoursCategory, MentorHoursEntry, MentorHoursRole } from "./types";

export const MENTOR_HOURS_LEDGER = "mentor_hours_entries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Whole minutes, strictly greater than zero. Fat-finger / missing values stay null. */
export function positiveDurationMinutes(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const rounded = Math.round(n);
  return rounded > 0 ? rounded : null;
}

export function assertPositiveDuration(value: unknown): number {
  const minutes = positiveDurationMinutes(value);
  if (minutes == null) {
    throw new Error("durationMinutes must be a positive number of minutes.");
  }
  return minutes;
}

export type MentorHoursLedgerRow = {
  id: string;
  mentorName: string;
  mentorUserId: string | null;
  role: MentorHoursRole;
  category: MentorHoursCategory;
  occurredOn: string;
  durationMinutes: number;
  seasonYear: number;
  notes: string | null;
};

export function mapLedgerRow(row: MentorHoursLedgerRow): MentorHoursEntry {
  return {
    id: row.id,
    mentorName: row.mentorName,
    mentorUserId: row.mentorUserId,
    role: row.role,
    category: row.category,
    occurredOn: row.occurredOn,
    durationMinutes: Number(row.durationMinutes) || 0,
    seasonYear: row.seasonYear,
    notes: row.notes,
  };
}

export async function listMentorHoursEntries(
  client: PoolClient,
  input: { orgId: string; seasonYear: number },
): Promise<MentorHoursEntry[]> {
  const result = await client.query<MentorHoursLedgerRow>(
    `SELECT id, mentor_name AS "mentorName", mentor_user_id AS "mentorUserId", role, category,
            occurred_on::text AS "occurredOn", duration_minutes AS "durationMinutes",
            season_year AS "seasonYear", notes
     FROM mentor_hours_entries
     WHERE org_id = $1::uuid AND season_year = $2::int
     ORDER BY occurred_on DESC, created_at DESC`,
    [input.orgId, input.seasonYear],
  );
  return result.rows.map(mapLedgerRow);
}

export async function listMentorHoursSeasons(
  client: PoolClient,
  orgId: string,
): Promise<number[]> {
  const result = await client.query<{ seasonYear: number }>(
    `SELECT DISTINCT season_year AS "seasonYear"
     FROM mentor_hours_entries
     WHERE org_id = $1::uuid
     ORDER BY season_year DESC`,
    [orgId],
  );
  return result.rows.map((row) => row.seasonYear);
}

export async function insertMentorHoursEntry(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    mentorName: string;
    mentorUserId?: string | null;
    role: MentorHoursRole;
    category: MentorHoursCategory;
    occurredOn: string;
    durationMinutes: unknown;
    notes: string | null;
    seasonYear: number;
  },
): Promise<void> {
  const durationMinutes = assertPositiveDuration(input.durationMinutes);
  const mentorUserId = isUuid(input.mentorUserId) ? input.mentorUserId : null;
  await client.query(
    `INSERT INTO mentor_hours_entries (
       org_id, mentor_name, role, category, occurred_on, duration_minutes, notes, season_year, logged_by, mentor_user_id
     ) VALUES ($1::uuid, $2, $3, $4, $5::date, $6::int, $7, $8::int, $9::uuid, $10::uuid)`,
    [
      input.orgId,
      input.mentorName,
      input.role,
      input.category,
      input.occurredOn,
      durationMinutes,
      input.notes,
      input.seasonYear,
      input.userId,
      mentorUserId,
    ],
  );
}

export async function deleteMentorHoursEntry(
  client: PoolClient,
  input: { orgId: string; entryId: string },
): Promise<void> {
  await client.query(`DELETE FROM mentor_hours_entries WHERE id = $1::uuid AND org_id = $2::uuid`, [
    input.entryId,
    input.orgId,
  ]);
}
