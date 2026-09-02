// Scout shifts — request-path persistence (migration 0497). Every write keeps
// scout_shifts (the plan) and scout_assignments (what Coverage / Lineup count) in step:
// a shift is expanded into one `role = 'shift'` assignment row per match it covers, and
// removing / re-planning a shift removes exactly those rows. Manual assignments made
// elsewhere (role 'primary' etc.) are never touched.

import type { PoolClient } from "@neondatabase/serverless";
import { emitPreferredNotification } from "@vantage/core";
import { lineupScoutNowHref } from "./lineup-related";
import {
  expandShift,
  shiftLabel,
  shiftsStartingWithin,
  type ShiftAlliance,
  type ShiftMatch,
  type ShiftStation,
} from "./shifts";

export const SHIFT_ASSIGNMENT_ROLE = "shift";
export const SHIFT_NOTIFICATION_TYPE = "scout_shift_assigned";

export type ShiftRow = {
  id: string;
  userId: string;
  userName: string | null;
  matchStart: number;
  matchEnd: number;
  alliance: ShiftAlliance | null;
  station: ShiftStation | null;
  notifyMinutesBefore: number;
  createdBy: string;
  updatedAt: string;
  /** Latest in-app reminder recorded in scout_shift_notifications, or null. */
  lastNotifiedAt: string | null;
};

export type ShiftView = ShiftRow & {
  label: string;
  /** Scheduled (predicted > event) time of the first match, or null when TBA has none. */
  startsAt: string | null;
  notifyState: "sent" | "due" | "scheduled" | "no_time";
};

export type RosterMember = { userId: string; name: string; role: string };

type MatchRow = {
  matchKey: string;
  matchNumber: number;
  red: { teamKeys?: string[] } | null;
  blue: { teamKeys?: string[] } | null;
  scheduledTime: string | null;
};

function keysOf(alliance: { teamKeys?: string[] } | null): string[] {
  return Array.isArray(alliance?.teamKeys) ? alliance!.teamKeys!.filter((key) => typeof key === "string") : [];
}

/** Qualification matches for the event in schedule order, shaped for the planner. */
export async function loadShiftMatches(client: PoolClient, eventKey: string): Promise<ShiftMatch[]> {
  const result = await client.query<MatchRow>(
    `SELECT match_key AS "matchKey", match_number AS "matchNumber",
            red_alliance AS red, blue_alliance AS blue,
            COALESCE(predicted_time, event_time)::text AS "scheduledTime"
     FROM matches_ref
     WHERE event_key = $1::text AND comp_level = 'qm'
     ORDER BY match_number`,
    [eventKey],
  );
  return result.rows.map((row) => ({
    matchKey: row.matchKey,
    matchNumber: Number(row.matchNumber),
    red: keysOf(row.red),
    blue: keysOf(row.blue),
    scheduledTime: row.scheduledTime,
  }));
}

export async function loadScoutRoster(client: PoolClient, orgId: string): Promise<RosterMember[]> {
  const result = await client.query<RosterMember>(
    `SELECT m.user_id AS "userId", COALESCE(u.name, 'Team scout') AS name, m.role::text AS role
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1::uuid AND m.role IN ('owner','admin','scout')
     ORDER BY CASE m.role WHEN 'scout' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`,
    [orgId],
  );
  return result.rows;
}

const SHIFT_COLUMNS = `
  s.id, s.user_id AS "userId", COALESCE(u.name, 'Team scout') AS "userName",
  s.match_start AS "matchStart", s.match_end AS "matchEnd",
  s.assigned_alliance AS alliance, s.assigned_station AS station,
  s.notify_minutes_before AS "notifyMinutesBefore", s.created_by AS "createdBy",
  s.updated_at::text AS "updatedAt",
  (SELECT max(n.sent_at) FROM scout_shift_notifications n WHERE n.shift_id = s.id)::text AS "lastNotifiedAt"`;

export async function loadShifts(client: PoolClient, orgId: string, eventKey: string): Promise<ShiftRow[]> {
  const result = await client.query<ShiftRow>(
    `SELECT ${SHIFT_COLUMNS}
     FROM scout_shifts s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.org_id = $1::uuid AND s.event_key = $2::text
     ORDER BY s.match_start, s.assigned_alliance, s.assigned_station, u.name`,
    [orgId, eventKey],
  );
  return result.rows.map(normalizeShiftRow);
}

export async function loadShift(client: PoolClient, orgId: string, shiftId: string): Promise<ShiftRow | null> {
  const result = await client.query<ShiftRow>(
    `SELECT ${SHIFT_COLUMNS}
     FROM scout_shifts s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.org_id = $1::uuid AND s.id = $2::uuid`,
    [orgId, shiftId],
  );
  const row = result.rows[0];
  return row ? normalizeShiftRow(row) : null;
}

function normalizeShiftRow(row: ShiftRow): ShiftRow {
  return {
    ...row,
    matchStart: Number(row.matchStart),
    matchEnd: Number(row.matchEnd),
    station: row.station == null ? null : (Number(row.station) as ShiftStation),
    notifyMinutesBefore: Number(row.notifyMinutesBefore),
  };
}

/** Decorate stored shifts with schedule times + the reminder state the lineup shows. */
export function shiftViews(shifts: ShiftRow[], matches: ShiftMatch[], now: Date | number = Date.now()): ShiftView[] {
  const timeByNumber = new Map(matches.map((match) => [match.matchNumber, match.scheduledTime ?? null]));
  const due = new Set(
    shiftsStartingWithin(shifts, matches, now).map((row) => row.shift.id),
  );
  return shifts.map((shift) => {
    const startsAt = timeByNumber.get(shift.matchStart) ?? null;
    const notifyState: ShiftView["notifyState"] = shift.lastNotifiedAt
      ? "sent"
      : !startsAt
        ? "no_time"
        : due.has(shift.id)
          ? "due"
          : "scheduled";
    return { ...shift, label: shiftLabel(shift), startsAt, notifyState };
  });
}

export type ShiftWriteInput = {
  orgId: string;
  eventKey: string;
  userId: string;
  matchStart: number;
  matchEnd: number;
  alliance: ShiftAlliance | null;
  station: ShiftStation | null;
  notifyMinutesBefore?: number | null;
  createdBy: string;
};

/** Upsert one shift row (unique per org/event/user/start). Returns its id. */
export async function upsertShift(client: PoolClient, input: ShiftWriteInput): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO scout_shifts
       (org_id, event_key, user_id, match_start, match_end, assigned_alliance, assigned_station,
        notify_minutes_before, created_by)
     VALUES ($1::uuid, $2::text, $3::uuid, $4::int, $5::int, $6::text, $7::int, $8::int, $9::uuid)
     ON CONFLICT (org_id, event_key, user_id, match_start) DO UPDATE SET
       match_end = EXCLUDED.match_end,
       assigned_alliance = EXCLUDED.assigned_alliance,
       assigned_station = EXCLUDED.assigned_station,
       notify_minutes_before = EXCLUDED.notify_minutes_before,
       updated_at = now()
     RETURNING id`,
    [
      input.orgId,
      input.eventKey,
      input.userId,
      input.matchStart,
      input.matchEnd,
      input.alliance,
      input.station,
      Math.min(240, Math.max(0, Math.trunc(input.notifyMinutesBefore ?? 10))),
      input.createdBy,
    ],
  );
  return result.rows[0]!.id;
}

/** Drop every `role = 'shift'` assignment row this shift expanded into. */
export async function deleteShiftAssignments(
  client: PoolClient,
  input: { orgId: string; eventKey: string; shift: Pick<ShiftRow, "userId" | "matchStart" | "matchEnd" | "alliance" | "station">; matches: ShiftMatch[] },
): Promise<void> {
  const rows = expandShift(input.shift, input.matches);
  if (!rows.length) return;
  await client.query(
    `DELETE FROM scout_assignments
     WHERE org_id = $1::uuid AND event_key = $2::text AND user_id = $3::uuid
       AND role = $4::text AND match_key = ANY($5::text[]) AND team_key = ANY($6::text[])`,
    [
      input.orgId,
      input.eventKey,
      input.shift.userId,
      SHIFT_ASSIGNMENT_ROLE,
      rows.map((row) => row.matchKey),
      rows.map((row) => row.teamKey),
    ],
  );
}

/** Expand a shift into per-match assignment rows (idempotent). */
export async function writeShiftAssignments(
  client: PoolClient,
  input: { orgId: string; eventKey: string; shift: Pick<ShiftRow, "userId" | "matchStart" | "matchEnd" | "alliance" | "station">; matches: ShiftMatch[] },
): Promise<number> {
  const rows = expandShift(input.shift, input.matches);
  for (const row of rows) {
    await client.query(
      `INSERT INTO scout_assignments (org_id, event_key, user_id, match_key, team_key, role)
       VALUES ($1::uuid, $2::text, $3::uuid, $4::text, $5::text, $6::text)
       ON CONFLICT (org_id, user_id, match_key, team_key) DO UPDATE SET role = EXCLUDED.role`,
      [input.orgId, input.eventKey, row.userId, row.matchKey, row.teamKey, SHIFT_ASSIGNMENT_ROLE],
    );
  }
  return rows.length;
}

/** Wipe an event's whole shift plan (rows + the assignments they expanded into). */
export async function clearShiftPlan(client: PoolClient, input: { orgId: string; eventKey: string }): Promise<void> {
  await client.query(
    `DELETE FROM scout_assignments WHERE org_id = $1::uuid AND event_key = $2::text AND role = $3::text`,
    [input.orgId, input.eventKey, SHIFT_ASSIGNMENT_ROLE],
  );
  await client.query(`DELETE FROM scout_shifts WHERE org_id = $1::uuid AND event_key = $2::text`, [
    input.orgId,
    input.eventKey,
  ]);
}

export async function deleteShift(
  client: PoolClient,
  input: { orgId: string; eventKey: string; shift: ShiftRow; matches: ShiftMatch[] },
): Promise<void> {
  await deleteShiftAssignments(client, input);
  await client.query(`DELETE FROM scout_shifts WHERE org_id = $1::uuid AND id = $2::uuid`, [
    input.orgId,
    input.shift.id,
  ]);
}

/**
 * In-app reminder to the assignee (respects their scoutReminders preference) and the
 * scout_shift_notifications receipt that turns the lineup's pill to "notified".
 */
export async function notifyShift(
  client: PoolClient,
  input: {
    orgId: string;
    eventKey: string;
    shifts: Array<Pick<ShiftRow, "id" | "userId" | "matchStart" | "matchEnd" | "alliance" | "station">>;
    matches: ShiftMatch[];
    reason?: "assigned" | "reminder" | "swapped";
  },
): Promise<{ notified: number }> {
  let notified = 0;
  const byUser = new Map<string, typeof input.shifts>();
  for (const shift of input.shifts) {
    const list = byUser.get(shift.userId) ?? [];
    list.push(shift);
    byUser.set(shift.userId, list);
  }
  const timeByNumber = new Map(input.matches.map((match) => [match.matchNumber, match.scheduledTime ?? null]));
  for (const [userId, shifts] of byUser) {
    const ordered = [...shifts].sort((a, b) => a.matchStart - b.matchStart);
    const first = ordered[0]!;
    const firstRows = expandShift(first, input.matches);
    const href = firstRows[0]
      ? lineupScoutNowHref(input.orgId, firstRows[0].matchKey, firstRows[0].teamKey)
      : `/scouting?orgId=${encodeURIComponent(input.orgId)}`;
    const labels = ordered.map((shift) => shiftLabel(shift));
    const startsAt = timeByNumber.get(first.matchStart) ?? null;
    const reason = input.reason ?? "assigned";
    const title =
      reason === "reminder"
        ? `Scouting shift starts soon — ${labels[0]}`
        : reason === "swapped"
          ? `Scouting shift swapped — ${labels[0]}`
          : ordered.length === 1
            ? `Scouting shift — ${labels[0]}`
            : `${ordered.length} scouting shifts assigned`;
    const message =
      ordered.length === 1
        ? `You are scouting ${labels[0]} at ${input.eventKey}${startsAt ? ` (first match ${new Date(startsAt).toLocaleTimeString()})` : ""}.`
        : `Your shifts at ${input.eventKey}: ${labels.join(", ")}.`;
    const result = await emitPreferredNotification(client, {
      userId,
      orgId: input.orgId,
      type: SHIFT_NOTIFICATION_TYPE,
      payload: {
        title,
        message,
        body: message,
        href,
        eventKey: input.eventKey,
        reason,
        shiftIds: ordered.map((shift) => shift.id),
        shifts: ordered.map((shift) => ({
          id: shift.id,
          matchStart: shift.matchStart,
          matchEnd: shift.matchEnd,
          alliance: shift.alliance,
          station: shift.station,
          label: shiftLabel(shift),
        })),
        startsAt,
      },
    });
    if (!result.emitted) continue;
    notified += 1;
    for (const shift of ordered) {
      await client.query(
        `INSERT INTO scout_shift_notifications (org_id, shift_id, channel) VALUES ($1::uuid, $2::uuid, 'inapp')`,
        [input.orgId, shift.id],
      );
    }
  }
  return { notified };
}
