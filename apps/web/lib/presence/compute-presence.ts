import type { PoolClient } from "@neondatabase/serverless";
import { expandOccurrences, localDateOf, normalizeTimeZone, safeParseRRule } from "../calendar/recurrence";
import { matchNameBacklog, type NameMatchResult } from "./match-names";
import { noRecordMembers, presenceDiscrepancies, reconcilePresence } from "./reconcile";
import { memberGoalBoard, summarizePresence, type MemberGoalRow, type PresenceSummary } from "./summary";
import { unifyPresence, type PresenceUnification } from "./unify";
import type {
  PresenceHourSignal,
  PresenceMemberRow,
  PresenceRollCallSignal,
  PresenceRsvp,
  PresenceRsvpSignal,
} from "./types";

export type PresenceSetupStep = { id: string; label: string; detail: string; href: string };

export type PresenceOccurrenceOption = {
  eventId: string;
  occurrenceDate: string;
  title: string;
  kind: string;
  subteamName: string | null;
  startsAt: string;
  endsAt: string | null;
  location: string;
  recurring: boolean;
  timeZone: string;
  attendanceEventId: string | null;
};

export type PresenceRosterMember = { userId: string; name: string | null; role: string };

export type PresenceUnlinkedHourLog = {
  hourLogId: string;
  userId: string;
  name: string | null;
  clockIn: string;
  clockOut: string | null;
  minutes: number;
  open: boolean;
};

export type PresenceUnmatchedName = NameMatchResult & { entryCount: number };

export type PresenceRollCallInfo = {
  taken: boolean;
  attendanceEventIds: string[];
  linked: boolean;
  /** Free-text entries on this occurrence's roll call that are not linked to a member. */
  unlinkedEntries: { entryId: string; personName: string; role: string }[];
};

export type PresenceView =
  | {
      status: "setup_required";
      message: string;
      steps: PresenceSetupStep[];
      orgId: string | null;
      presenceDate: string;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      canManage: boolean;
      presenceDate: string;
      occurrences: PresenceOccurrenceOption[];
      selected: PresenceOccurrenceOption | null;
      rows: PresenceMemberRow[];
      discrepancies: PresenceMemberRow[];
      noRecord: { userId: string; name: string | null }[];
      /** Distinct members coming or already here — the one "who is coming tonight" number. */
      comingTonight: number;
      unification: PresenceUnification;
      summary: PresenceSummary | null;
      rollCall: PresenceRollCallInfo;
      unlinkedHourLogs: PresenceUnlinkedHourLog[];
      unmatchedNames: PresenceUnmatchedName[];
      memberGoals: MemberGoalRow[];
      goalHours: number | null;
      recordedCount: number;
      computedAt: string;
    };

export function todayIsoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isPresenceDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

const num = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const numOrNull = (value: unknown): number | null => {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Copied from apps/web/lib/event-day-plan/compute-event-day-plan.ts. */
async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null; role: string } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null; role: string }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber", m.role::text AS role
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

type EventRow = {
  id: string;
  title: string;
  kind: string;
  subteamName: string | null;
  startsAt: string;
  endsAt: string | null;
  location: string;
  attendanceEventId: string | null;
  rrule: string | null;
  recurrenceEnd: string | null;
  timeZone: string;
  seriesId: string | null;
};

/**
 * Every calendar occurrence that lands on `presenceDate`.
 *
 * Concrete rows are filtered by their local date; recurring masters are expanded
 * through the shared recurrence engine (migration 0456) so fourteen Tuesdays stay
 * fourteen distinct occurrences rather than collapsing onto one event id.
 */
async function occurrencesForDate(
  client: PoolClient,
  orgId: string,
  presenceDate: string,
): Promise<PresenceOccurrenceOption[]> {
  const events = await client.query<EventRow>(
    `SELECT e.id, e.title, e.kind, s.name AS "subteamName",
            e.starts_at AS "startsAt", e.ends_at AS "endsAt", e.location,
            e.attendance_event_id AS "attendanceEventId",
            e.rrule, e.recurrence_end::text AS "recurrenceEnd",
            e.recurrence_timezone AS "timeZone", e.series_id AS "seriesId"
     FROM subteam_calendar_events e
     LEFT JOIN team_subteams s ON s.id = e.subteam_id
     WHERE e.org_id = $1::uuid
       AND (
         (e.rrule IS NULL
          AND e.starts_at >= ($2::date - 2)::timestamptz
          AND e.starts_at < ($2::date + 2)::timestamptz)
         OR (e.rrule IS NOT NULL
             AND e.starts_at < ($2::date + 2)::timestamptz
             AND (e.recurrence_end IS NULL OR e.recurrence_end >= $2::date))
       )
     ORDER BY e.starts_at ASC
     LIMIT 200`,
    [orgId, presenceDate],
  );

  const seriesIds = events.rows.filter((row) => row.rrule).map((row) => row.id);
  const exceptionsBySeries = new Map<string, { occurrenceDate: string; action: "skipped" | "moved" | "edited" }[]>();
  if (seriesIds.length > 0) {
    const exceptions = await client.query<{ seriesId: string; occurrenceDate: string; action: string }>(
      `SELECT series_id AS "seriesId", occurrence_date AS "occurrenceDate", action
       FROM calendar_event_exceptions
       WHERE org_id = $1::uuid AND series_id = ANY($2::uuid[])`,
      [orgId, seriesIds],
    );
    for (const row of exceptions.rows) {
      const list = exceptionsBySeries.get(row.seriesId) ?? [];
      list.push({
        occurrenceDate: new Date(row.occurrenceDate).toISOString(),
        action: row.action as "skipped" | "moved" | "edited",
      });
      exceptionsBySeries.set(row.seriesId, list);
    }
  }

  const options: PresenceOccurrenceOption[] = [];
  for (const row of events.rows) {
    const timeZone = normalizeTimeZone(row.timeZone);
    const startsAt = new Date(row.startsAt).toISOString();
    const endsAt = row.endsAt ? new Date(row.endsAt).toISOString() : null;

    if (!row.rrule) {
      if (localDateOf(startsAt, timeZone) !== presenceDate) continue;
      options.push({
        eventId: row.id,
        occurrenceDate: presenceDate,
        title: row.title,
        kind: row.kind,
        subteamName: row.subteamName,
        startsAt,
        endsAt,
        location: row.location,
        recurring: false,
        timeZone,
        attendanceEventId: row.attendanceEventId,
      });
      continue;
    }

    const parsed = safeParseRRule(row.rrule);
    if (!parsed.ok) continue;
    const durationMs = endsAt ? new Date(endsAt).getTime() - new Date(startsAt).getTime() : null;
    // Generous UTC window around the local day (any IANA offset fits inside
    // ±36h); the local-date filter below is the real predicate.
    const midnightUtc = new Date(`${presenceDate}T00:00:00Z`).getTime();
    let expanded;
    try {
      expanded = expandOccurrences({
        rrule: parsed.rule,
        start: startsAt,
        durationMs,
        timeZone,
        windowStart: new Date(midnightUtc - 36 * 3_600_000).toISOString(),
        windowEnd: new Date(midnightUtc + 60 * 3_600_000).toISOString(),
        exceptions: exceptionsBySeries.get(row.id) ?? [],
        recurrenceEnd: row.recurrenceEnd,
        maxOccurrences: 10,
      });
    } catch {
      continue;
    }
    for (const occurrence of expanded) {
      if (localDateOf(occurrence.startsAt, timeZone) !== presenceDate) continue;
      options.push({
        eventId: row.id,
        occurrenceDate: presenceDate,
        title: row.title,
        kind: row.kind,
        subteamName: row.subteamName,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        location: row.location,
        recurring: true,
        timeZone,
        attendanceEventId: row.attendanceEventId,
      });
    }
  }

  return options.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export async function computePresenceView(
  client: PoolClient,
  input: {
    userId: string;
    requestedOrg: string | null;
    presenceDate?: string | null;
    eventId?: string | null;
  },
): Promise<PresenceView> {
  const presenceDate = isPresenceDate(input.presenceDate) ? input.presenceDate : todayIsoDate();
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to see who is coming and who was here.",
      steps: [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose which FRC team you are working as.",
          href: "/workspace",
        },
      ],
      orgId: null,
      presenceDate,
    };
  }

  const canManage = org.role === "owner" || org.role === "admin";
  const occurrences = await occurrencesForDate(client, org.orgId, presenceDate);
  const selected =
    (input.eventId ? occurrences.find((option) => option.eventId === input.eventId) : null) ??
    occurrences[0] ??
    null;

  const rosterResult = await client.query<PresenceRosterMember>(
    `SELECT m.user_id AS "userId", u.name, m.role::text AS role
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1::uuid
     ORDER BY u.name`,
    [org.orgId],
  );
  const roster = rosterResult.rows;

  const policyResult = await client.query<{ goalHours: string | null; seasonStart: string | null }>(
    `SELECT season_goal_hours AS "goalHours", season_start::text AS "seasonStart"
     FROM hour_policies WHERE org_id = $1::uuid`,
    [org.orgId],
  );
  const goalHours = numOrNull(policyResult.rows[0]?.goalHours);
  const seasonStart = policyResult.rows[0]?.seasonStart ?? null;

  const totalsResult = await client.query<{ userId: string; name: string | null; totalHours: string }>(
    `SELECT h.user_id AS "userId", u.name,
            SUM(EXTRACT(EPOCH FROM (h.clock_out - h.clock_in)) / 3600.0) AS "totalHours"
     FROM hour_logs h
     JOIN users u ON u.id = h.user_id
     WHERE h.org_id = $1::uuid
       AND h.clock_out IS NOT NULL
       AND ($2::date IS NULL OR h.clock_in >= $2::date)
     GROUP BY h.user_id, u.name`,
    [org.orgId, seasonStart],
  );
  const memberGoals = memberGoalBoard(
    totalsResult.rows.map((row) => ({
      userId: row.userId,
      name: row.name,
      totalHours: num(row.totalHours),
    })),
    goalHours,
  );

  const backlogResult = await client.query<{ personName: string; entryCount: number }>(
    `SELECT person_name AS "personName", COUNT(*)::int AS "entryCount"
     FROM attendance_entries
     WHERE org_id = $1::uuid AND user_id IS NULL
     GROUP BY person_name
     ORDER BY COUNT(*) DESC, person_name ASC
     LIMIT 60`,
    [org.orgId],
  );
  const unmatchedNames = matchNameBacklog(
    backlogResult.rows.map((row) => ({ personName: row.personName, entryCount: row.entryCount })),
    roster.map((member) => ({ userId: member.userId, name: member.name })),
  );

  const emptyRollCall: PresenceRollCallInfo = {
    taken: false,
    attendanceEventIds: [],
    linked: false,
    unlinkedEntries: [],
  };

  if (!selected) {
    const emptyUnification = unifyPresence({
      rsvps: [],
      rollCall: [],
      hourLogs: [],
      occurrenceDate: presenceDate,
    });
    return {
      status: "live",
      orgId: org.orgId,
      teamNumber: org.teamNumber,
      canManage,
      presenceDate,
      occurrences,
      selected: null,
      rows: [],
      discrepancies: [],
      noRecord: [],
      comingTonight: 0,
      unification: emptyUnification,
      summary: null,
      rollCall: emptyRollCall,
      unlinkedHourLogs: [],
      unmatchedNames,
      memberGoals,
      goalHours,
      recordedCount: 0,
      computedAt: new Date().toISOString(),
    };
  }

  // --- RSVPs ---------------------------------------------------------------
  const rsvpResult = await client.query<{
    userId: string;
    name: string | null;
    response: PresenceRsvp;
  }>(
    `SELECT r.user_id AS "userId", u.name, r.response
     FROM subteam_calendar_rsvps r
     JOIN users u ON u.id = r.user_id
     WHERE r.org_id = $1::uuid AND r.event_id = $2::uuid`,
    [org.orgId, selected.eventId],
  );
  const rsvps: PresenceRsvpSignal[] = rsvpResult.rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    response: row.response,
    // An RSVP on a recurring master is a standing answer for the series, not a
    // promise about this specific night. The UI says so rather than pretending.
    scope: selected.recurring ? "series" : "occurrence",
  }));

  // --- Roll call -----------------------------------------------------------
  const rollCallEvents = await client.query<{ id: string }>(
    `SELECT id FROM attendance_events
     WHERE org_id = $1::uuid
       AND (
         ($2::uuid IS NOT NULL AND id = $2::uuid)
         OR ($2::uuid IS NULL AND occurred_on = $3::date)
       )`,
    [org.orgId, selected.attendanceEventId, presenceDate],
  );
  const attendanceEventIds = rollCallEvents.rows.map((row) => row.id);

  const rollCall: PresenceRollCallSignal[] = [];
  const unlinkedEntries: PresenceRollCallInfo["unlinkedEntries"] = [];
  if (attendanceEventIds.length > 0) {
    const entryResult = await client.query<{
      entryId: string;
      userId: string | null;
      personName: string;
      role: string;
      hours: string | null;
      name: string | null;
    }>(
      `SELECT en.id AS "entryId", en.user_id AS "userId", en.person_name AS "personName",
              en.role, en.hours, u.name
       FROM attendance_entries en
       LEFT JOIN users u ON u.id = en.user_id
       WHERE en.org_id = $1::uuid AND en.event_id = ANY($2::uuid[])
       ORDER BY en.person_name ASC`,
      [org.orgId, attendanceEventIds],
    );
    for (const row of entryResult.rows) {
      if (row.userId) {
        rollCall.push({
          userId: row.userId,
          name: row.name ?? row.personName,
          present: true,
          hours: numOrNull(row.hours),
        });
      } else {
        unlinkedEntries.push({
          entryId: row.entryId,
          personName: row.personName,
          role: row.role,
        });
      }
    }
  }

  // --- Hours ---------------------------------------------------------------
  const linkedHoursResult = await client.query<{
    hourLogId: string;
    userId: string;
    name: string | null;
    minutes: string;
    open: boolean;
  }>(
    `SELECT h.id AS "hourLogId", h.user_id AS "userId", u.name,
            EXTRACT(EPOCH FROM (COALESCE(h.clock_out, now()) - h.clock_in)) / 60.0 AS minutes,
            (h.clock_out IS NULL) AS open
     FROM hour_logs h
     JOIN users u ON u.id = h.user_id
     WHERE h.org_id = $1::uuid
       AND h.calendar_event_id = $2::uuid
       AND h.occurrence_date = $3::date
     ORDER BY h.clock_in ASC`,
    [org.orgId, selected.eventId, presenceDate],
  );
  const hourLogs: PresenceHourSignal[] = linkedHoursResult.rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    hourLogId: row.hourLogId,
    minutes: num(row.minutes),
    open: row.open,
  }));

  const unlinkedHoursResult = await client.query<{
    hourLogId: string;
    userId: string;
    name: string | null;
    clockIn: string;
    clockOut: string | null;
    minutes: string;
    open: boolean;
  }>(
    `SELECT h.id AS "hourLogId", h.user_id AS "userId", u.name,
            h.clock_in AS "clockIn", h.clock_out AS "clockOut",
            EXTRACT(EPOCH FROM (COALESCE(h.clock_out, now()) - h.clock_in)) / 60.0 AS minutes,
            (h.clock_out IS NULL) AS open
     FROM hour_logs h
     JOIN users u ON u.id = h.user_id
     WHERE h.org_id = $1::uuid
       AND h.calendar_event_id IS NULL
       AND h.clock_in >= ($2::date - 1)::timestamptz
       AND h.clock_in < ($2::date + 2)::timestamptz
     ORDER BY h.clock_in ASC
     LIMIT 200`,
    [org.orgId, presenceDate],
  );
  const unlinkedHourLogs: PresenceUnlinkedHourLog[] = unlinkedHoursResult.rows
    .map((row) => ({
      hourLogId: row.hourLogId,
      userId: row.userId,
      name: row.name,
      clockIn: new Date(row.clockIn).toISOString(),
      clockOut: row.clockOut ? new Date(row.clockOut).toISOString() : null,
      minutes: num(row.minutes),
      open: row.open,
    }))
    .filter((row) => localDateOf(row.clockIn, selected.timeZone) === presenceDate);

  // --- Already-reconciled rows --------------------------------------------
  const recordedResult = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM presence_records
     WHERE org_id = $1::uuid AND calendar_event_id = $2::uuid AND occurrence_date = $3::date`,
    [org.orgId, selected.eventId, presenceDate],
  );

  const rollCallTaken = attendanceEventIds.length > 0;
  const reconcileInput = {
    rsvps,
    rollCall,
    hourLogs,
    occurrenceDate: presenceDate,
    rollCallTaken,
  };
  const rows = reconcilePresence(reconcileInput);
  const unification = unifyPresence(reconcileInput);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    canManage,
    presenceDate,
    occurrences,
    selected,
    rows,
    discrepancies: presenceDiscrepancies(rows),
    noRecord: noRecordMembers(
      roster.map((member) => ({ userId: member.userId, name: member.name })),
      rows,
    ),
    comingTonight: unification.comingTonight,
    unification,
    summary: summarizePresence({
      rows,
      rosterCount: roster.length,
      rollCallTaken,
      rsvpsRecorded: rsvps.length > 0,
    }),
    rollCall: {
      taken: rollCallTaken,
      attendanceEventIds,
      linked: selected.attendanceEventId != null,
      unlinkedEntries,
    },
    unlinkedHourLogs,
    unmatchedNames,
    memberGoals,
    goalHours,
    recordedCount: recordedResult.rows[0]?.count ?? 0,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

/** Confirmed link of a free-text roll-call name to a member account. */
export async function linkAttendancePerson(
  client: PoolClient,
  input: { orgId: string; personName: string; userId: string | null },
): Promise<number> {
  const result = await client.query(
    `UPDATE attendance_entries
     SET user_id = $3::uuid
     WHERE org_id = $1::uuid AND person_name = $2::text`,
    [input.orgId, input.personName, input.userId],
  );
  return result.rowCount ?? 0;
}

export async function upsertPresenceRecord(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    calendarEventId: string;
    occurrenceDate: string;
    rsvp: PresenceRsvp | null;
    attended: boolean | null;
    hourLogId: string | null;
    minutes: number | null;
    source: string;
    note: string;
    recordedBy: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO presence_records (
       org_id, user_id, calendar_event_id, occurrence_date,
       rsvp, attended, hour_log_id, minutes, source, note, recorded_by
     ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::date,$5,$6::boolean,$7::uuid,$8::numeric,$9,$10,$11::uuid)
     ON CONFLICT (org_id, user_id, calendar_event_id, occurrence_date) DO UPDATE
       SET rsvp = EXCLUDED.rsvp,
           attended = EXCLUDED.attended,
           hour_log_id = EXCLUDED.hour_log_id,
           minutes = EXCLUDED.minutes,
           source = EXCLUDED.source,
           note = EXCLUDED.note,
           recorded_by = EXCLUDED.recorded_by,
           updated_at = now()`,
    [
      input.orgId,
      input.userId,
      input.calendarEventId,
      input.occurrenceDate,
      input.rsvp,
      input.attended,
      input.hourLogId,
      input.minutes,
      input.source,
      input.note,
      input.recordedBy,
    ],
  );
}

export async function linkHourLog(
  client: PoolClient,
  input: { orgId: string; hourLogId: string; calendarEventId: string; occurrenceDate: string },
): Promise<number> {
  const result = await client.query(
    `UPDATE hour_logs
     SET calendar_event_id = $3::uuid, occurrence_date = $4::date
     WHERE org_id = $1::uuid AND id = $2::uuid`,
    [input.orgId, input.hourLogId, input.calendarEventId, input.occurrenceDate],
  );
  return result.rowCount ?? 0;
}

export async function unlinkHourLog(
  client: PoolClient,
  input: { orgId: string; hourLogId: string },
): Promise<number> {
  const result = await client.query(
    `UPDATE hour_logs
     SET calendar_event_id = NULL, occurrence_date = NULL
     WHERE org_id = $1::uuid AND id = $2::uuid`,
    [input.orgId, input.hourLogId],
  );
  return result.rowCount ?? 0;
}

export async function deletePresenceRecord(
  client: PoolClient,
  input: { orgId: string; userId: string; calendarEventId: string; occurrenceDate: string },
): Promise<number> {
  const result = await client.query(
    `DELETE FROM presence_records
     WHERE org_id = $1::uuid AND user_id = $2::uuid
       AND calendar_event_id = $3::uuid AND occurrence_date = $4::date`,
    [input.orgId, input.userId, input.calendarEventId, input.occurrenceDate],
  );
  return result.rowCount ?? 0;
}
