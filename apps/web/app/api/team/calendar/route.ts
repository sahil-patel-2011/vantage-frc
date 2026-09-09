import type { PoolClient } from "@neondatabase/serverless";
import { randomBytes } from "node:crypto";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { buildCalendar, type CalendarIcsEvent } from "../../../../lib/calendar-ics";
import { describeRRule, RecurrenceError } from "../../../../lib/calendar/recurrence";
import {
  expandSeriesRows,
  parseOccurrenceRef,
  parseOccurrenceScope,
  parseRepeatInput,
  splitSeriesRule,
  type OccurrenceScope,
  type RecurrenceEventFields,
  type SeriesRow,
  type StoredException,
} from "../../../../lib/calendar/series";
import { listDutiesForOrg } from "../../../../lib/duty-roster";
import {
  createGitHubHttp,
  fetchGitHubMilestoneCalendarItems,
  getGitHubAccessToken,
} from "../../../../lib/github";
import { notifyCalendarEvent } from "../../../../lib/notify-calendar";
import {
  attendanceDateFromStart,
  CALENDAR_FEED_SCOPES,
  defaultSeasonYear,
  eventsForMySubteams,
  filterEventsBySubteam,
  parseSubteamCalendarAction,
  type CalendarFeedInfo,
  type CalendarFeedScope,
  type CalendarEvent,
  type DutyOnCalendar,
  type GitHubCalendarOverlay,
  type LinkableAttendance,
  type LinkablePractice,
  type RsvpResponse,
  type Subteam,
  type SubteamCalendarView,
  type SubteamMemberLite,
  type TravelLegOnCalendar,
  githubItemsToIcsEvents,
  tbaMatchesToCalendarEvents,
} from "../../../../lib/subteam-calendar";

function newFeedToken() {
  return randomBytes(32).toString("base64url");
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Authentication required");
  return session;
}

async function membershipRole(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query<{ role: string }>(
    `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
    [orgId, userId],
  );
  if (!row.rowCount) throw new HttpError(403, "Organization membership required");
  return row.rows[0]!.role;
}

const isAdmin = (role: string) => role === "owner" || role === "admin";

const GITHUB_OVERLAY_TIMEOUT_MS = 4000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("GitHub calendar overlay timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Overlay open GitHub milestones that already have due dates. Never invent dates; never fail the calendar. */
async function loadGitHubCalendarOverlay(
  client: PoolClient,
  orgId: string,
): Promise<GitHubCalendarOverlay> {
  const empty: GitHubCalendarOverlay = { connected: false, repo: null, items: [] };
  try {
    const authToken = await getGitHubAccessToken(client, orgId);
    if (!authToken) return empty;
    const repo = authToken.connection.defaultRepoFullName?.trim() || null;
    if (!repo) return { connected: true, repo: null, items: [] };
    try {
      const milestones = await withTimeout(
        fetchGitHubMilestoneCalendarItems(createGitHubHttp(authToken.accessToken), repo),
        GITHUB_OVERLAY_TIMEOUT_MS,
      );
      return {
        connected: true,
        repo,
        items: milestones.map((item) => ({
          id: item.id,
          title: item.title,
          dueOn: item.dueOn,
          href: item.htmlUrl,
          source: "github" as const,
        })),
      };
    } catch {
      return { connected: true, repo, items: [] };
    }
  } catch {
    return empty;
  }
}

/** This team's matches at the active event. Empty if TBA cache has no time — never invent DEMO matches. */
async function loadTbaMatchCalendar(client: PoolClient, orgId: string, teamNumber: number | null): Promise<CalendarEvent[]> {
  if (teamNumber == null || !Number.isFinite(teamNumber)) return [];
  const teamKey = `frc${teamNumber}`;
  try {
    const result = await client.query<{
      matchKey: string;
      compLevel: string;
      matchNumber: number;
      scheduledTime: string | null;
      redAlliance: unknown;
      blueAlliance: unknown;
      eventName: string | null;
    }>(
      `SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.match_number AS "matchNumber",
              COALESCE(m.actual_time, m.predicted_time, m.event_time)::text AS "scheduledTime",
              m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance",
              ev.name AS "eventName"
       FROM org_active_context ctx
       JOIN matches_ref m ON m.event_key = ctx.active_event_key
       LEFT JOIN events_ref ev ON ev.event_key = ctx.active_event_key
       WHERE ctx.org_id = $1::uuid
         AND COALESCE(m.actual_time, m.predicted_time, m.event_time) IS NOT NULL
       ORDER BY COALESCE(m.actual_time, m.predicted_time, m.event_time) ASC
       LIMIT 120`,
      [orgId],
    );
    return tbaMatchesToCalendarEvents(result.rows, teamKey);
  } catch {
    return [];
  }
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Calendar request failed";
  if (/team_subteams|subteam_calendar_events|relation .* does not exist/i.test(message)) {
    return Response.json(
      { error: "Apply the subteam calendars migration first (0111_subteam_calendars)." },
      { status: 503 },
    );
  }
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: message }, { status });
}

async function loadCalendarFeed(
  client: PoolClient,
  orgId: string,
  userId: string,
  scope: CalendarFeedScope,
  subteamId: string | null,
): Promise<CalendarFeedInfo> {
  try {
    const row = await client.query<{ token: string }>(
      `SELECT token FROM calendar_feed_tokens
       WHERE org_id = $1 AND user_id = $2 AND scope = $3
         AND (($4::uuid IS NULL AND subteam_id IS NULL) OR subteam_id = $4::uuid)
       LIMIT 1`,
      [orgId, userId, scope, subteamId],
    );
    return { token: row.rows[0]?.token ?? null, scope, subteamId };
  } catch {
    return { token: null, scope, subteamId };
  }
}

/* ------------------------------------------------------------------ *
 * Recurrence (migration 0456)
 * ------------------------------------------------------------------ */

/** How far back / forward occurrences are materialized for the UI. */
const OCCURRENCE_LOOKBACK_DAYS = 120;
const OCCURRENCE_LOOKAHEAD_DAYS = 400;
/** Per-series ceiling so one runaway rule cannot flood the response. */
const MAX_OCCURRENCES_PER_SERIES = 200;

type StoredEventRow = Omit<CalendarEvent, "myRsvp" | "rsvpGoing" | "rsvpMaybe" | "rsvpNo"> &
  RecurrenceEventFields;

const BASE_EVENT_COLUMNS = `e.id, e.title, e.kind, e.starts_at::text AS "startsAt", e.ends_at::text AS "endsAt",
              e.location, e.notes, e.subteam_id AS "subteamId",
              st.name AS "subteamName", st.color AS "subteamColor",
              e.attendance_event_id AS "attendanceEventId",
              ae.title AS "attendanceEventTitle",
              e.milestone_id AS "milestoneId",
              e.driver_session_id AS "driverSessionId",
              cb.name AS "createdByName"`;

const EVENT_JOINS = `FROM subteam_calendar_events e
       LEFT JOIN team_subteams st ON st.id = e.subteam_id
       LEFT JOIN attendance_events ae ON ae.id = e.attendance_event_id
       LEFT JOIN users cb ON cb.id = e.created_by`;

/**
 * Stored calendar rows. Series masters are kept even when their DTSTART is far
 * in the past — a build season created in January still has meetings in March.
 * Falls back to the pre-0456 shape so the calendar keeps working (without
 * recurrence) on a database where the migration has not been applied.
 */
async function loadStoredEventRows(
  client: PoolClient,
  orgId: string,
): Promise<{ rows: StoredEventRow[]; recurrenceReady: boolean }> {
  try {
    const result = await client.query<StoredEventRow>(
      `SELECT ${BASE_EVENT_COLUMNS},
              e.rrule, e.recurrence_end::text AS "recurrenceEnd",
              e.series_id AS "seriesId",
              e.recurrence_timezone AS "recurrenceTimezone"
       ${EVENT_JOINS}
       WHERE e.org_id = $1
         AND (
           e.starts_at > now() - interval '${OCCURRENCE_LOOKBACK_DAYS} days'
           OR (
             e.rrule IS NOT NULL
             AND (e.recurrence_end IS NULL
                  OR e.recurrence_end > CURRENT_DATE - ${OCCURRENCE_LOOKBACK_DAYS})
           )
         )
       ORDER BY e.starts_at ASC
       LIMIT 800`,
      [orgId],
    );
    return { rows: result.rows, recurrenceReady: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/rrule|recurrence_end|series_id|recurrence_timezone|column .* does not exist/i.test(message)) {
      throw error;
    }
    const result = await client.query<StoredEventRow>(
      `SELECT ${BASE_EVENT_COLUMNS}
       ${EVENT_JOINS}
       WHERE e.org_id = $1
         AND e.starts_at > now() - interval '${OCCURRENCE_LOOKBACK_DAYS} days'
       ORDER BY e.starts_at ASC
       LIMIT 800`,
      [orgId],
    );
    return { rows: result.rows, recurrenceReady: false };
  }
}

/** Recorded skips / moves / edits. Absent table simply means no exceptions. */
async function loadSeriesExceptions(
  client: PoolClient,
  orgId: string,
): Promise<StoredException[]> {
  try {
    const result = await client.query<StoredException>(
      // Occurrence identity is matched as an exact instant, so the timestamp is
      // rendered as unambiguous UTC ISO rather than the session's text format.
      `SELECT series_id AS "seriesId",
              to_char(occurrence_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                AS "occurrenceDate",
              action, detached_event_id AS "detachedEventId"
       FROM calendar_event_exceptions
       WHERE org_id = $1`,
      [orgId],
    );
    return result.rows.map((row) => ({
      ...row,
      occurrenceDate: new Date(row.occurrenceDate).toISOString(),
    }));
  } catch {
    return [];
  }
}

/**
 * Turn stored rows into the flat event list the calendar renders: a series
 * master becomes its occurrences inside the window, everything else passes
 * through untouched. Occurrences after the first carry a composite
 * `<master>#<original ISO>` id; the first keeps the row's real uuid so existing
 * RSVPs, attendance links, and duty rows still resolve.
 */
function materializeCalendarRows(
  rows: StoredEventRow[],
  exceptions: StoredException[],
  now: Date,
): StoredEventRow[] {
  const seriesRows: SeriesRow[] = rows.map((row) => ({
    id: row.id,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    rrule: row.rrule ?? null,
    recurrenceEnd: row.recurrenceEnd ?? null,
    seriesId: row.seriesId ?? null,
    recurrenceTimezone: row.recurrenceTimezone ?? null,
  }));

  const windowStart = new Date(now.getTime() - OCCURRENCE_LOOKBACK_DAYS * 86400000).toISOString();
  const windowEnd = new Date(now.getTime() + OCCURRENCE_LOOKAHEAD_DAYS * 86400000).toISOString();
  const expanded = expandSeriesRows(seriesRows, exceptions, {
    windowStart,
    windowEnd,
    maxPerSeries: MAX_OCCURRENCES_PER_SERIES,
  });

  const out: StoredEventRow[] = [];
  for (const row of rows) {
    const occurrences = expanded.get(row.id);
    if (!occurrences) {
      out.push(row);
      continue;
    }
    const summary = row.rrule
      ? describeRRule(row.rrule, { start: row.startsAt, timeZone: row.recurrenceTimezone ?? "UTC" })
      : null;
    for (const occurrence of occurrences) {
      out.push({
        ...row,
        id: occurrence.id,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        seriesId: row.id,
        occurrenceStart: occurrence.occurrenceStart,
        isOccurrence: true,
        recurrenceSummary: summary,
      });
    }
  }
  out.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
  return out;
}

async function loadView(
  client: PoolClient,
  orgId: string,
  userId: string,
  role: string,
  feedScope: CalendarFeedScope = "personal",
  feedSubteamId: string | null = null,
): Promise<SubteamCalendarView> {
  const org = await client.query<{ orgName: string; teamNumber: number | null }>(
    `SELECT name AS "orgName", team_number AS "teamNumber" FROM organizations WHERE id = $1`,
    [orgId],
  );
  const orgRow = org.rows[0];
  if (!orgRow) throw new HttpError(404, "Organization not found");

  const [subteams, members, events, subteamMembers] = await Promise.all([
    client.query<Omit<Subteam, "memberCount"> & { memberCount: number }>(
      `SELECT s.id, s.name, s.color, s.description, s.sort_order AS "sortOrder",
              (SELECT count(*)::int FROM team_subteam_members sm WHERE sm.subteam_id = s.id) AS "memberCount"
       FROM team_subteams s
       WHERE s.org_id = $1
       ORDER BY s.sort_order, lower(s.name)`,
      [orgId],
    ),
    client.query<Omit<SubteamMemberLite, "subteamIds">>(
      `SELECT m.user_id AS "userId", u.name, u.email, m.role
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1
       ORDER BY lower(coalesce(u.name, u.email)), u.email
       LIMIT 500`,
      [orgId],
    ),
    loadStoredEventRows(client, orgId),
    client.query<{ subteamId: string; userId: string }>(
      `SELECT subteam_id AS "subteamId", user_id AS "userId"
       FROM team_subteam_members WHERE org_id = $1`,
      [orgId],
    ),
  ]);

  const membershipsByUser = new Map<string, string[]>();
  for (const row of subteamMembers.rows) {
    const list = membershipsByUser.get(row.userId) ?? [];
    list.push(row.subteamId);
    membershipsByUser.set(row.userId, list);
  }

  const memberRows: SubteamMemberLite[] = members.rows.map((member) => ({
    ...member,
    subteamIds: membershipsByUser.get(member.userId) ?? [],
  }));

  const rsvpByEvent = new Map<
    string,
    { myRsvp: RsvpResponse | null; rsvpGoing: number; rsvpMaybe: number; rsvpNo: number }
  >();
  try {
    const rsvps = await client.query<{
      eventId: string;
      userId: string;
      response: RsvpResponse;
    }>(
      `SELECT event_id AS "eventId", user_id AS "userId", response
       FROM subteam_calendar_rsvps
       WHERE org_id = $1`,
      [orgId],
    );
    for (const row of rsvps.rows) {
      const bucket = rsvpByEvent.get(row.eventId) ?? {
        myRsvp: null,
        rsvpGoing: 0,
        rsvpMaybe: 0,
        rsvpNo: 0,
      };
      if (row.response === "going") bucket.rsvpGoing += 1;
      else if (row.response === "maybe") bucket.rsvpMaybe += 1;
      else bucket.rsvpNo += 1;
      if (row.userId === userId) bucket.myRsvp = row.response;
      rsvpByEvent.set(row.eventId, bucket);
    }
  } catch {
    // Migration 0141 may not be applied yet — calendar still works without RSVPs.
  }

  const exceptions = events.recurrenceReady ? await loadSeriesExceptions(client, orgId) : [];
  const materialized = events.recurrenceReady
    ? materializeCalendarRows(events.rows, exceptions, new Date())
    : events.rows;

  const eventRows: CalendarEvent[] = materialized.map((row) => {
    const rsvp = rsvpByEvent.get(row.id);
    return {
      ...row,
      myRsvp: rsvp?.myRsvp ?? null,
      rsvpGoing: rsvp?.rsvpGoing ?? 0,
      rsvpMaybe: rsvp?.rsvpMaybe ?? 0,
      rsvpNo: rsvp?.rsvpNo ?? 0,
    };
  });

  let attendanceEvents: LinkableAttendance[] = [];
  try {
    const attendance = await client.query<LinkableAttendance>(
      `SELECT id, title, occurred_on::text AS "occurredOn", kind
       FROM attendance_events
       WHERE org_id = $1
       ORDER BY occurred_on DESC
       LIMIT 100`,
      [orgId],
    );
    attendanceEvents = attendance.rows;
  } catch {
    // Table absent: stays [].
  }

  let practiceSessions: LinkablePractice[] = [];
  try {
    const practice = await client.query<LinkablePractice>(
      `SELECT id, title, session_date::text AS "sessionDate"
       FROM driver_sessions
       WHERE org_id = $1
       ORDER BY session_date DESC
       LIMIT 100`,
      [orgId],
    );
    practiceSessions = practice.rows;
  } catch {
    // Table absent: stays [].
  }

  const calendarFeed = await loadCalendarFeed(client, orgId, userId, feedScope, feedSubteamId);

  let duties: DutyOnCalendar[] = [];
  try {
    const roster = await listDutiesForOrg(client, orgId, userId);
    duties = roster.map((duty) => ({
      id: duty.id,
      title: duty.title,
      kind: duty.kind,
      startsAt: duty.startsAt,
      endsAt: duty.endsAt,
      subteamId: duty.subteamId,
      subteamName: duty.subteamName,
      subteamColor: duty.subteamColor,
      assignedUserId: duty.assignedUserId,
      assignedUserName: duty.assignedUserName,
      calendarEventId: duty.calendarEventId,
      notes: duty.notes,
      createdByName: duty.createdByName,
      mine: duty.mine,
    }));
  } catch {
    // Table absent: stays [].
  }


  let travelLegs: TravelLegOnCalendar[] = [];
  try {
    const legs = await client.query<TravelLegOnCalendar>(
      `SELECT l.id, l.trip_id AS "tripId", t.title AS "tripTitle", l.kind, l.title,
              l.starts_at::text AS "startsAt", l.ends_at::text AS "endsAt",
              l.location, l.meeting_point AS "meetingPoint", l.notes,
              l.subteam_id AS "subteamId", st.name AS "subteamName", st.color AS "subteamColor",
              l.calendar_event_id AS "calendarEventId"
       FROM logistics_travel_legs l
       JOIN logistics_trips t ON t.id = l.trip_id
       LEFT JOIN team_subteams st ON st.id = l.subteam_id
       WHERE l.org_id = $1
       ORDER BY l.starts_at, l.sort_order
       LIMIT 200`,
      [orgId],
    );
    travelLegs = legs.rows;
  } catch {
    // Table absent: stays [].
  }

  const githubCalendar = await loadGitHubCalendarOverlay(client, orgId);
  const tbaMatches = await loadTbaMatchCalendar(client, orgId, orgRow.teamNumber);

  return {
    status: "ready",
    context: {
      orgId,
      orgName: orgRow.orgName,
      teamNumber: orgRow.teamNumber,
      role,
      userId,
      canManage: isAdmin(role),
    },
    subteams: subteams.rows,
    members: memberRows,
    events: eventRows,
    duties,
    travelLegs,
    mySubteamIds: membershipsByUser.get(userId) ?? [],
    attendanceEvents,
    practiceSessions,
    calendarFeed,
    githubCalendar,
    tbaMatches,
  };
}

function eventsToIcs(view: Extract<SubteamCalendarView, { status: "ready" }>, scope: CalendarFeedScope, subteamId: string | null) {
  let events = [...view.events, ...(view.tbaMatches ?? [])];
  if (scope === "personal") events = eventsForMySubteams(events, view.mySubteamIds);
  else if (scope === "subteam") events = filterEventsBySubteam(events, subteamId);

  const icsEvents: CalendarIcsEvent[] = events.map((event) => ({
    id: event.id,
    title: event.title,
    kind: event.kind,
    location: event.location,
    description: event.notes,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    updatedAt: event.startsAt,
    allDay: false,
  }));

  if (scope !== "subteam") {
    icsEvents.push(...githubItemsToIcsEvents(view.githubCalendar?.items));
  }

  // Duties without a linked calendar row still appear on personal / org feeds.
  const userId = view.context.userId;
  for (const duty of view.duties ?? []) {
    if (duty.calendarEventId && events.some((event) => event.id === duty.calendarEventId)) continue;
    if (scope === "personal" && userId) {
      const onMySubteam =
        duty.assignedUserId == null &&
        duty.subteamId != null &&
        view.mySubteamIds.includes(duty.subteamId);
      if (duty.assignedUserId !== userId && !onMySubteam) continue;
    } else if (scope === "subteam" && subteamId && duty.subteamId !== subteamId) {
      continue;
    }
    icsEvents.push({
      id: `duty-${duty.id}`,
      title: duty.title,
      kind: duty.kind === "outreach" ? "outreach" : "event",
      location: "",
      description: [duty.assignedUserName ? `Assigned: ${duty.assignedUserName}` : null, duty.notes]
        .filter(Boolean)
        .join("\n"),
      startsAt: duty.startsAt,
      endsAt: duty.endsAt,
      updatedAt: duty.startsAt,
      allDay: false,
    });
  }

  return buildCalendar(
    {
      orgName: view.context.orgName,
      teamNumber: view.context.teamNumber,
      scope,
      timezone: "UTC",
      events: icsEvents,
    },
    { domain: "vantagefrc.com" },
  );
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");
    const format = url.searchParams.get("format");
    const scopeRaw = url.searchParams.get("scope") ?? "personal";
    const scope = (CALENDAR_FEED_SCOPES as readonly string[]).includes(scopeRaw)
      ? (scopeRaw as CalendarFeedScope)
      : "personal";
    const feedSubteamId = url.searchParams.get("subteamId");

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<{ orgId: string; role: string }>(
        `SELECT m.org_id AS "orgId", m.role
         FROM memberships m
         WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
         LIMIT 1`,
        [session.user.id, requestedOrg],
      );
      const row = membership.rows[0];
      if (!row) {
        return {
          status: "setup_required",
          message: "Select a team workspace to open subteam calendars.",
          context: {
            orgId: null,
            orgName: null,
            teamNumber: null,
            role: null,
            userId: session.user.id,
            canManage: false,
          },
        } satisfies SubteamCalendarView;
      }
      if (scope === "subteam" && feedSubteamId) {
        const st = await client.query(
          `SELECT 1 FROM team_subteams WHERE id = $1 AND org_id = $2 LIMIT 1`,
          [feedSubteamId, row.orgId],
        );
        if (!st.rowCount) throw new HttpError(400, "Subteam not found");
      }
      return loadView(
        client,
        row.orgId,
        session.user.id,
        row.role,
        scope,
        scope === "subteam" ? feedSubteamId : null,
      );
    });

    if (format === "ics") {
      if (view.status !== "ready") {
        return Response.json({ error: view.message }, { status: 400 });
      }
      const ics = eventsToIcs(view, scope, scope === "subteam" ? feedSubteamId : null);
      return new Response(ics, {
        status: 200,
        headers: {
          "content-type": "text/calendar; charset=utf-8",
          "content-disposition": 'attachment; filename="vantage-calendar.ics"',
          "cache-control": "private, no-store",
        },
      });
    }

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

/* ------------------------------------------------------------------ *
 * Occurrence-scoped writes (this / this and following / all events)
 * ------------------------------------------------------------------ */

type MasterRow = {
  id: string;
  startsAt: string;
  endsAt: string | null;
  rrule: string | null;
  recurrenceEnd: string | null;
  seriesId: string | null;
  recurrenceTimezone: string | null;
};

async function loadMaster(
  client: PoolClient,
  orgId: string,
  id: string,
): Promise<MasterRow | null> {
  const result = await client.query<MasterRow>(
    `SELECT id, starts_at::text AS "startsAt", ends_at::text AS "endsAt", rrule,
            recurrence_end::text AS "recurrenceEnd", series_id AS "seriesId",
            recurrence_timezone AS "recurrenceTimezone"
     FROM subteam_calendar_events
     WHERE id = $1::uuid AND org_id = $2::uuid
     LIMIT 1`,
    [id, orgId],
  );
  return result.rows[0] ?? null;
}

/** Drop the detached row (if any) recorded for one occurrence of a series. */
async function clearDetachedRow(
  client: PoolClient,
  orgId: string,
  seriesId: string,
  occurrenceIso: string,
): Promise<void> {
  // The exception's FK is ON DELETE CASCADE, so removing the detached row also
  // removes the exception — the caller writes the replacement afterwards.
  await client.query(
    `DELETE FROM subteam_calendar_events
     WHERE org_id = $1::uuid
       AND id IN (
         SELECT detached_event_id FROM calendar_event_exceptions
         WHERE org_id = $1::uuid AND series_id = $2::uuid
           AND occurrence_date = $3::timestamptz
           AND detached_event_id IS NOT NULL
       )`,
    [orgId, seriesId, occurrenceIso],
  );
  await client.query(
    `DELETE FROM calendar_event_exceptions
     WHERE org_id = $1::uuid AND series_id = $2::uuid AND occurrence_date = $3::timestamptz`,
    [orgId, seriesId, occurrenceIso],
  );
}

/**
 * Pin one occurrence of a series to a row of its own so it can be edited or
 * moved. Idempotent: an occurrence already detached returns its existing row.
 */
async function materializeOccurrence(
  client: PoolClient,
  orgId: string,
  userId: string,
  seriesId: string,
  occurrenceIso: string,
): Promise<string> {
  const existing = await client.query<{ detachedEventId: string | null }>(
    `SELECT detached_event_id AS "detachedEventId"
     FROM calendar_event_exceptions
     WHERE org_id = $1::uuid AND series_id = $2::uuid AND occurrence_date = $3::timestamptz
     LIMIT 1`,
    [orgId, seriesId, occurrenceIso],
  );
  const already = existing.rows[0]?.detachedEventId;
  if (already) return already;

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO subteam_calendar_events
       (org_id, subteam_id, title, kind, starts_at, ends_at, location, notes,
        milestone_id, driver_session_id, series_id, recurrence_timezone, created_by)
     SELECT e.org_id, e.subteam_id, e.title, e.kind,
            $3::timestamptz,
            CASE WHEN e.ends_at IS NULL THEN NULL
                 ELSE $3::timestamptz + (e.ends_at - e.starts_at) END,
            e.location, e.notes, e.milestone_id, e.driver_session_id,
            e.id, e.recurrence_timezone, $4::uuid
     FROM subteam_calendar_events e
     WHERE e.id = $2::uuid AND e.org_id = $1::uuid AND e.rrule IS NOT NULL
     RETURNING id`,
    [orgId, seriesId, occurrenceIso, userId],
  );
  const detachedId = inserted.rows[0]?.id;
  if (!detachedId) throw new HttpError(404, "Repeating event not found");

  await client.query(
    `INSERT INTO calendar_event_exceptions
       (org_id, series_id, occurrence_date, action, override, detached_event_id, created_by)
     VALUES ($1::uuid, $2::uuid, $3::timestamptz, 'edited', '{}'::jsonb, $4::uuid, $5::uuid)
     ON CONFLICT (series_id, occurrence_date) DO UPDATE
       SET action = 'edited',
           detached_event_id = EXCLUDED.detached_event_id,
           updated_at = now()`,
    [orgId, seriesId, occurrenceIso, detachedId, userId],
  );
  return detachedId;
}

/** Forget overrides at or after a split point, so a new tail series is clean. */
async function dropExceptionsFrom(
  client: PoolClient,
  orgId: string,
  seriesId: string,
  fromIso: string,
): Promise<void> {
  await client.query(
    `DELETE FROM subteam_calendar_events
     WHERE org_id = $1::uuid
       AND id IN (
         SELECT detached_event_id FROM calendar_event_exceptions
         WHERE org_id = $1::uuid AND series_id = $2::uuid
           AND occurrence_date >= $3::timestamptz
           AND detached_event_id IS NOT NULL
       )`,
    [orgId, seriesId, fromIso],
  );
  await client.query(
    `DELETE FROM calendar_event_exceptions
     WHERE org_id = $1::uuid AND series_id = $2::uuid AND occurrence_date >= $3::timestamptz`,
    [orgId, seriesId, fromIso],
  );
}

type EventFieldPatch = {
  title?: string;
  kind?: string;
  startsAt?: string;
  endsAt?: string | null;
  location?: string;
  notes?: string;
  subteamId?: string | null;
};

function readEventPatch(source: Record<string, unknown>): EventFieldPatch {
  const patch: EventFieldPatch = {};
  const text = (value: unknown, max: number) => String(value ?? "").slice(0, max);
  if (Object.prototype.hasOwnProperty.call(source, "title")) {
    const title = text(source.title, 200).trim();
    if (!title) throw new HttpError(400, "Title is required");
    patch.title = title;
  }
  if (Object.prototype.hasOwnProperty.call(source, "kind")) patch.kind = text(source.kind, 40);
  if (Object.prototype.hasOwnProperty.call(source, "location")) {
    patch.location = text(source.location, 200);
  }
  if (Object.prototype.hasOwnProperty.call(source, "notes")) patch.notes = text(source.notes, 2000);
  if (Object.prototype.hasOwnProperty.call(source, "subteamId")) {
    const value = source.subteamId;
    patch.subteamId = value == null || value === "" ? null : String(value);
  }
  const isoOf = (value: unknown, label: string) => {
    const ms = new Date(String(value)).getTime();
    if (Number.isNaN(ms)) throw new HttpError(400, `${label} is not a valid date and time`);
    return new Date(ms).toISOString();
  };
  if (Object.prototype.hasOwnProperty.call(source, "startsAt")) {
    patch.startsAt = isoOf(source.startsAt, "Start");
  }
  if (Object.prototype.hasOwnProperty.call(source, "endsAt")) {
    patch.endsAt =
      source.endsAt == null || source.endsAt === "" ? null : isoOf(source.endsAt, "End");
  }
  if (patch.startsAt && patch.endsAt && patch.endsAt < patch.startsAt) {
    throw new HttpError(400, "End must be on or after the start");
  }
  return patch;
}

async function applyPatchToRow(
  client: PoolClient,
  orgId: string,
  rowId: string,
  patch: EventFieldPatch,
  extra: { rrule?: string | null; recurrenceEnd?: string | null; timeZone?: string } = {},
): Promise<void> {
  const values: unknown[] = [rowId, orgId];
  const sets: string[] = [];
  const push = (column: string, value: unknown, cast = "") => {
    values.push(value);
    sets.push(`${column} = $${values.length}${cast}`);
  };
  if (patch.title != null) push("title", patch.title);
  if (patch.kind != null) push("kind", patch.kind);
  if (patch.location != null) push("location", patch.location);
  if (patch.notes != null) push("notes", patch.notes);
  if (Object.prototype.hasOwnProperty.call(patch, "subteamId")) {
    push("subteam_id", patch.subteamId, "::uuid");
  }
  if (patch.startsAt != null) push("starts_at", patch.startsAt, "::timestamptz");
  if (Object.prototype.hasOwnProperty.call(patch, "endsAt")) {
    push("ends_at", patch.endsAt, "::timestamptz");
  }
  if (Object.prototype.hasOwnProperty.call(extra, "rrule")) push("rrule", extra.rrule);
  if (Object.prototype.hasOwnProperty.call(extra, "recurrenceEnd")) {
    push("recurrence_end", extra.recurrenceEnd, "::date");
  }
  if (extra.timeZone) push("recurrence_timezone", extra.timeZone);
  if (sets.length === 0) throw new HttpError(400, "No event fields to update");

  const updated = await client.query(
    `UPDATE subteam_calendar_events SET ${sets.join(", ")}, updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    values,
  );
  if (!updated.rowCount) throw new HttpError(404, "Event not found");
}

/**
 * Start a new series at `startIso` by copying `sourceId` and applying `patch`.
 * Used by "this and following", which leaves the past alone and rewrites the
 * remainder as its own series.
 */
async function forkSeries(
  client: PoolClient,
  orgId: string,
  userId: string,
  sourceId: string,
  startIso: string,
  rrule: string,
  recurrenceEnd: string | null,
  patch: EventFieldPatch,
): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO subteam_calendar_events
       (org_id, subteam_id, title, kind, starts_at, ends_at, location, notes,
        milestone_id, driver_session_id, rrule, recurrence_end, recurrence_timezone, created_by)
     SELECT e.org_id, e.subteam_id, e.title, e.kind,
            $3::timestamptz,
            CASE WHEN e.ends_at IS NULL THEN NULL
                 ELSE $3::timestamptz + (e.ends_at - e.starts_at) END,
            e.location, e.notes, e.milestone_id, e.driver_session_id,
            $4, $5::date, e.recurrence_timezone, $6::uuid
     FROM subteam_calendar_events e
     WHERE e.id = $2::uuid AND e.org_id = $1::uuid
     RETURNING id`,
    [orgId, sourceId, startIso, rrule, recurrenceEnd, userId],
  );
  const newId = inserted.rows[0]?.id;
  if (!newId) throw new HttpError(404, "Repeating event not found");
  await client.query(
    `UPDATE subteam_calendar_events SET series_id = id WHERE id = $1::uuid AND org_id = $2::uuid`,
    [newId, orgId],
  );
  const rest: EventFieldPatch = { ...patch };
  delete rest.startsAt;
  if (Object.keys(rest).length > 0) await applyPatchToRow(client, orgId, newId, rest);
  return newId;
}

function recurrenceUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /calendar_event_exceptions|rrule|recurrence_end|series_id|recurrence_timezone/i.test(
    message,
  ) && /does not exist/i.test(message);
}

async function handleOccurrenceWrite(
  client: PoolClient,
  orgId: string,
  userId: string,
  body: Record<string, unknown>,
  mode: "update" | "delete",
): Promise<Record<string, unknown>> {
  const ref = parseOccurrenceRef(body.id);
  const scope: OccurrenceScope = parseOccurrenceScope(body.scope);
  const master = await loadMaster(client, orgId, ref.rowId);
  if (!master) throw new HttpError(404, "Event not found");

  // A plain row with no rule is just an event — no scope choice applies.
  if (!master.rrule) {
    if (mode === "delete") {
      const deleted = await client.query(
        `DELETE FROM subteam_calendar_events WHERE id = $1::uuid AND org_id = $2::uuid`,
        [ref.rowId, orgId],
      );
      if (!deleted.rowCount) throw new HttpError(404, "Event not found");
      return { ok: true, scope: "this" };
    }
    await applyPatchToRow(client, orgId, ref.rowId, readEventPatch(bodyPatch(body)));
    return { ok: true, scope: "this" };
  }

  const occurrenceIso = ref.occurrenceStart ?? new Date(master.startsAt).toISOString();
  const timeZone = master.recurrenceTimezone ?? "UTC";

  if (mode === "delete") {
    if (scope === "all") {
      await client.query(
        `DELETE FROM subteam_calendar_events WHERE id = $1::uuid AND org_id = $2::uuid`,
        [master.id, orgId],
      );
      return { ok: true, scope };
    }
    if (scope === "following") {
      const split = splitSeriesRule({
        rrule: master.rrule,
        start: master.startsAt,
        splitStart: occurrenceIso,
        timeZone,
        recurrenceEnd: master.recurrenceEnd,
      });
      await dropExceptionsFrom(client, orgId, master.id, occurrenceIso);
      if (!split.head) {
        await client.query(
          `DELETE FROM subteam_calendar_events WHERE id = $1::uuid AND org_id = $2::uuid`,
          [master.id, orgId],
        );
        return { ok: true, scope, deletedSeries: true };
      }
      await applyPatchToRow(
        client,
        orgId,
        master.id,
        {},
        { rrule: split.head.rrule, recurrenceEnd: split.head.recurrenceEnd },
      );
      return { ok: true, scope };
    }
    // scope === "this": record a skip so the ICS feed emits an EXDATE.
    await clearDetachedRow(client, orgId, master.id, occurrenceIso);
    await client.query(
      `INSERT INTO calendar_event_exceptions
         (org_id, series_id, occurrence_date, action, override, created_by)
       VALUES ($1::uuid, $2::uuid, $3::timestamptz, 'skipped', '{}'::jsonb, $4::uuid)
       ON CONFLICT (series_id, occurrence_date) DO UPDATE
         SET action = 'skipped', detached_event_id = NULL, updated_at = now()`,
      [orgId, master.id, occurrenceIso, userId],
    );
    return { ok: true, scope, skipped: occurrenceIso };
  }

  const patch = readEventPatch(bodyPatch(body));
  const repeat = Object.prototype.hasOwnProperty.call(bodyPatch(body), "rrule")
    ? parseRepeatInput({ ...bodyPatch(body), timeZone })
    : null;

  if (scope === "all") {
    // Moving DTSTART shifts the whole series; the rule itself is unchanged
    // unless the caller also sent a new one.
    await applyPatchToRow(
      client,
      orgId,
      master.id,
      patch,
      repeat
        ? { rrule: repeat.rrule, recurrenceEnd: repeat.recurrenceEnd, timeZone: repeat.timeZone }
        : {},
    );
    return { ok: true, scope, id: master.id };
  }

  if (scope === "following") {
    const split = splitSeriesRule({
      rrule: master.rrule,
      start: master.startsAt,
      splitStart: occurrenceIso,
      timeZone,
      recurrenceEnd: master.recurrenceEnd,
    });
    if (!split.head) {
      await applyPatchToRow(
        client,
        orgId,
        master.id,
        patch,
        repeat
          ? { rrule: repeat.rrule, recurrenceEnd: repeat.recurrenceEnd, timeZone: repeat.timeZone }
          : {},
      );
      return { ok: true, scope: "all", id: master.id };
    }
    await dropExceptionsFrom(client, orgId, master.id, occurrenceIso);
    const tailRule = repeat?.rrule ?? split.tail.rrule;
    const tailEnd = repeat ? repeat.recurrenceEnd : split.tail.recurrenceEnd;
    const newId = await forkSeries(
      client,
      orgId,
      userId,
      master.id,
      patch.startsAt ?? occurrenceIso,
      tailRule,
      tailEnd,
      patch,
    );
    await applyPatchToRow(
      client,
      orgId,
      master.id,
      {},
      { rrule: split.head.rrule, recurrenceEnd: split.head.recurrenceEnd },
    );
    return { ok: true, scope, id: newId };
  }

  // scope === "this": pin the occurrence to its own row and edit that.
  const detachedId = await materializeOccurrence(client, orgId, userId, master.id, occurrenceIso);
  if (Object.keys(patch).length > 0) {
    await applyPatchToRow(client, orgId, detachedId, patch);
    if (patch.startsAt && patch.startsAt !== occurrenceIso) {
      await client.query(
        `UPDATE calendar_event_exceptions SET action = 'moved', updated_at = now()
         WHERE org_id = $1::uuid AND series_id = $2::uuid AND occurrence_date = $3::timestamptz`,
        [orgId, master.id, occurrenceIso],
      );
    }
  }
  return { ok: true, scope, id: detachedId };
}

function bodyPatch(body: Record<string, unknown>): Record<string, unknown> {
  const patch = body.patch;
  if (patch && typeof patch === "object" && !Array.isArray(patch)) {
    return patch as Record<string, unknown>;
  }
  return {};
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const rawBody = await request.json();
    const body: Record<string, unknown> =
      rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {};
    const rawAction = typeof body.action === "string" ? body.action : "";

    // Occurrence-scoped writes never reach parseSubteamCalendarAction — they are
    // recurrence-only verbs owned by this route.
    if (rawAction === "update_occurrence" || rawAction === "delete_occurrence") {
      const orgId = typeof body.orgId === "string" ? body.orgId : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) {
        throw new HttpError(400, "Organization is required");
      }
      const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
        await membershipRole(client, orgId, session.user.id);
        try {
          return await handleOccurrenceWrite(
            client,
            orgId,
            session.user.id,
            body,
            rawAction === "delete_occurrence" ? "delete" : "update",
          );
        } catch (error) {
          if (recurrenceUnavailable(error)) {
            throw new HttpError(
              503,
              "Apply the recurring events migration first (0456_calendar_recurrence).",
            );
          }
          if (error instanceof RecurrenceError) throw new HttpError(400, error.message);
          throw error;
        }
      });
      return Response.json(result);
    }

    // RSVPing to a virtual occurrence pins it to a row of its own first, so the
    // response is attached to that meeting and not to the whole series.
    if (rawAction === "set_rsvp" && typeof body.id === "string" && body.id.includes("#")) {
      const orgId = typeof body.orgId === "string" ? body.orgId : "";
      const ref = parseOccurrenceRef(body.id);
      if (ref.occurrenceStart && /^[0-9a-f-]{36}$/i.test(orgId)) {
        body.id = await withRls({ userId: session.user.id, orgId }, async (client) => {
          await membershipRole(client, orgId, session.user.id);
          try {
            return await materializeOccurrence(
              client,
              orgId,
              session.user.id,
              ref.rowId,
              ref.occurrenceStart!,
            );
          } catch (error) {
            if (recurrenceUnavailable(error)) {
              throw new HttpError(
                503,
                "Apply the recurring events migration first (0456_calendar_recurrence).",
              );
            }
            throw error;
          }
        });
      }
    }

    const action = parseSubteamCalendarAction(body);
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      const role = await membershipRole(client, action.orgId, userId);

      switch (action.action) {
        case "create_subteam": {
          if (!isAdmin(role)) throw new HttpError(403, "Only owners and admins can create subteams");
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO team_subteams (org_id, name, color, description, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [action.orgId, action.name, action.color, action.description, userId],
          );
          return { id: inserted.rows[0]!.id };
        }

        case "update_subteam": {
          if (!isAdmin(role)) throw new HttpError(403, "Only owners and admins can edit subteams");
          const values: unknown[] = [action.id, action.orgId];
          const sets: string[] = [];
          const push = (column: string, value: unknown) => {
            values.push(value);
            sets.push(`${column} = $${values.length}`);
          };
          if (action.name != null) push("name", action.name);
          if (action.color != null) push("color", action.color);
          if (action.description != null) push("description", action.description);
          const updated = await client.query(
            `UPDATE team_subteams SET ${sets.join(", ")}, updated_at = now()
             WHERE id = $1 AND org_id = $2`,
            values,
          );
          if (!updated.rowCount) throw new HttpError(404, "Subteam not found");
          return { ok: true };
        }

        case "delete_subteam": {
          if (!isAdmin(role)) throw new HttpError(403, "Only owners and admins can delete subteams");
          const deleted = await client.query(`DELETE FROM team_subteams WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          if (!deleted.rowCount) throw new HttpError(404, "Subteam not found");
          return { ok: true };
        }

        case "set_member_subteams": {
          if (!isAdmin(role)) throw new HttpError(403, "Only owners and admins can assign subteams");
          const member = await client.query(
            `SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
            [action.orgId, action.userId],
          );
          if (!member.rowCount) throw new HttpError(404, "Member not found on this team");

          if (action.subteamIds.length > 0) {
            const valid = await client.query<{ id: string }>(
              `SELECT id FROM team_subteams WHERE org_id = $1 AND id = ANY($2::uuid[])`,
              [action.orgId, action.subteamIds],
            );
            if (valid.rowCount !== action.subteamIds.length) {
              throw new HttpError(400, "One or more subteams are invalid for this team");
            }
          }

          await client.query(`DELETE FROM team_subteam_members WHERE org_id = $1 AND user_id = $2`, [
            action.orgId,
            action.userId,
          ]);
          for (const subteamId of action.subteamIds) {
            await client.query(
              `INSERT INTO team_subteam_members (org_id, subteam_id, user_id, added_by)
               VALUES ($1, $2, $3, $4)`,
              [action.orgId, subteamId, action.userId, userId],
            );
          }
          return { ok: true };
        }

        case "create_event": {
          if (action.subteamId) {
            const st = await client.query(
              `SELECT 1 FROM team_subteams WHERE id = $1 AND org_id = $2 LIMIT 1`,
              [action.subteamId, action.orgId],
            );
            if (!st.rowCount) throw new HttpError(400, "Subteam not found");
          }

          let attendanceEventId = action.attendanceEventId;
          if (attendanceEventId) {
            const ae = await client.query(
              `SELECT 1 FROM attendance_events WHERE id = $1 AND org_id = $2 LIMIT 1`,
              [attendanceEventId, action.orgId],
            );
            if (!ae.rowCount) throw new HttpError(400, "Attendance event not found");
          } else if (action.createAttendance) {
            if (!isAdmin(role)) {
              throw new HttpError(403, "Only owners and admins can create attendance roll-call from the calendar");
            }
            const kind =
              action.kind === "practice" || action.kind === "build" || action.kind === "meeting" || action.kind === "outreach"
                ? action.kind
                : "other";
            const inserted = await client.query<{ id: string }>(
              `INSERT INTO attendance_events
                 (org_id, title, kind, occurred_on, credit_hours, season_year, created_by)
               VALUES ($1, $2, $3, $4::date, $5, $6, $7)
               RETURNING id`,
              [
                action.orgId,
                action.title,
                kind,
                attendanceDateFromStart(action.startsAt),
                action.attendanceCreditHours,
                defaultSeasonYear(new Date(action.startsAt)),
                userId,
              ],
            );
            attendanceEventId = inserted.rows[0]!.id;
          }

          if (action.driverSessionId) {
            try {
              const sessionRow = await client.query(
                `SELECT 1 FROM driver_sessions WHERE id = $1 AND org_id = $2 LIMIT 1`,
                [action.driverSessionId, action.orgId],
              );
              if (!sessionRow.rowCount) throw new HttpError(400, "Practice session not found");
            } catch (error) {
              if (error instanceof HttpError) throw error;
              throw new HttpError(400, "Practice sessions are not available in this environment");
            }
          }

          if (action.milestoneId) {
            const milestone = await client.query(
              `SELECT 1 FROM season_milestones WHERE id = $1 AND org_id = $2 LIMIT 1`,
              [action.milestoneId, action.orgId],
            );
            if (!milestone.rowCount) throw new HttpError(400, "Milestone not found");
          }

          // Optional repeat rule. Rejected loudly if it is outside the supported
          // subset — a rule we cannot expand must never reach the table.
          let repeat: { rrule: string | null; timeZone: string; recurrenceEnd: string | null };
          try {
            repeat = parseRepeatInput(body);
          } catch (error) {
            if (error instanceof RecurrenceError) throw new HttpError(400, error.message);
            throw error;
          }

          let eventId: string;
          try {
            const inserted = await client.query<{ id: string }>(
              `INSERT INTO subteam_calendar_events
                 (org_id, subteam_id, title, kind, starts_at, ends_at, location, notes,
                  attendance_event_id, milestone_id, driver_session_id, created_by,
                  rrule, recurrence_end, recurrence_timezone)
               VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8, $9, $10, $11, $12,
                       $13, $14::date, $15)
               RETURNING id`,
              [
                action.orgId,
                action.subteamId,
                action.title,
                action.kind,
                action.startsAt,
                action.endsAt,
                action.location,
                action.notes,
                attendanceEventId,
                action.milestoneId,
                action.driverSessionId,
                userId,
                repeat.rrule,
                repeat.recurrenceEnd,
                repeat.timeZone,
              ],
            );
            eventId = inserted.rows[0]!.id;
            if (repeat.rrule) {
              // A master owns its own series; detached occurrences point back here.
              await client.query(
                `UPDATE subteam_calendar_events SET series_id = id
                 WHERE id = $1::uuid AND org_id = $2::uuid`,
                [eventId, action.orgId],
              );
            }
          } catch (error) {
            if (recurrenceUnavailable(error)) {
              if (repeat.rrule) {
                throw new HttpError(
                  503,
                  "Apply the recurring events migration first (0456_calendar_recurrence).",
                );
              }
              // No repeat requested — fall back to the pre-0456 column set.
              const inserted = await client.query<{ id: string }>(
                `INSERT INTO subteam_calendar_events
                   (org_id, subteam_id, title, kind, starts_at, ends_at, location, notes,
                    attendance_event_id, milestone_id, driver_session_id, created_by)
                 VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8, $9, $10, $11, $12)
                 RETURNING id`,
                [
                  action.orgId,
                  action.subteamId,
                  action.title,
                  action.kind,
                  action.startsAt,
                  action.endsAt,
                  action.location,
                  action.notes,
                  attendanceEventId,
                  action.milestoneId,
                  action.driverSessionId,
                  userId,
                ],
              );
              eventId = inserted.rows[0]!.id;
            } else {
              throw error;
            }
          }
          // notifyCalendarEvent takes its own savepoint, so a failed fan-out
          // costs the notifications and not the event that was just written.
          await notifyCalendarEvent(client, {
            orgId: action.orgId,
            actorUserId: userId,
            eventId,
            title: action.title,
            subteamId: action.subteamId,
            mode: "created",
          });
          return { id: eventId, attendanceEventId };
        }

        case "update_event": {
          const values: unknown[] = [action.id, action.orgId];
          const sets: string[] = [];
          const push = (column: string, value: unknown) => {
            values.push(value);
            sets.push(`${column} = $${values.length}`);
          };
          const patch = action.patch;
          if (Object.prototype.hasOwnProperty.call(patch, "title")) push("title", patch.title);
          if (Object.prototype.hasOwnProperty.call(patch, "kind")) push("kind", patch.kind);
          if (Object.prototype.hasOwnProperty.call(patch, "startsAt")) push("starts_at", patch.startsAt);
          if (Object.prototype.hasOwnProperty.call(patch, "endsAt")) push("ends_at", patch.endsAt);
          if (Object.prototype.hasOwnProperty.call(patch, "location")) push("location", patch.location);
          if (Object.prototype.hasOwnProperty.call(patch, "notes")) push("notes", patch.notes);
          if (Object.prototype.hasOwnProperty.call(patch, "subteamId")) push("subteam_id", patch.subteamId);
          if (Object.prototype.hasOwnProperty.call(patch, "attendanceEventId")) {
            push("attendance_event_id", patch.attendanceEventId);
          }
          if (Object.prototype.hasOwnProperty.call(patch, "driverSessionId")) {
            push("driver_session_id", patch.driverSessionId);
          }
          if (Object.prototype.hasOwnProperty.call(patch, "milestoneId")) {
            push("milestone_id", patch.milestoneId);
          }
          if (sets.length < 1) throw new HttpError(400, "No event fields to update");
          const updated = await client.query<{ title: string; subteamId: string | null }>(
            `UPDATE subteam_calendar_events SET ${sets.join(", ")}, updated_at = now()
             WHERE id = $1 AND org_id = $2
             RETURNING title, subteam_id AS "subteamId"`,
            values,
          );
          if (!updated.rowCount) throw new HttpError(404, "Event not found");
          const row = updated.rows[0]!;
          await notifyCalendarEvent(client, {
            orgId: action.orgId,
            actorUserId: userId,
            eventId: action.id,
            title: row.title,
            subteamId: row.subteamId,
            mode: "updated",
          });
          return { ok: true };
        }

        case "delete_event": {
          const deleted = await client.query(
            `DELETE FROM subteam_calendar_events WHERE id = $1 AND org_id = $2`,
            [action.id, action.orgId],
          );
          if (!deleted.rowCount) throw new HttpError(404, "Event not found");
          return { ok: true };
        }

        case "set_rsvp": {
          const exists = await client.query(
            `SELECT 1 FROM subteam_calendar_events WHERE id = $1 AND org_id = $2 LIMIT 1`,
            [action.id, action.orgId],
          );
          if (!exists.rowCount) throw new HttpError(404, "Event not found");
          try {
            if (action.response == null) {
              await client.query(
                `DELETE FROM subteam_calendar_rsvps
                 WHERE org_id = $1 AND event_id = $2 AND user_id = $3`,
                [action.orgId, action.id, userId],
              );
            } else {
              await client.query(
                `INSERT INTO subteam_calendar_rsvps (org_id, event_id, user_id, response, note, responded_at)
                 VALUES ($1, $2, $3, $4, $5, now())
                 ON CONFLICT (event_id, user_id) DO UPDATE
                   SET response = EXCLUDED.response,
                       note = EXCLUDED.note,
                       responded_at = now()`,
                [action.orgId, action.id, userId, action.response, action.note],
              );
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : "";
            if (/subteam_calendar_rsvps|does not exist/i.test(message)) {
              throw new HttpError(503, "Apply the RSVP migration first (0147_subteam_calendar_rsvps).");
            }
            throw error;
          }
          return { ok: true, response: action.response };
        }

        case "ensure_calendar_feed":
        case "rotate_calendar_feed": {
          if (action.scope === "subteam" && action.subteamId) {
            const st = await client.query(
              `SELECT 1 FROM team_subteams WHERE id = $1 AND org_id = $2 LIMIT 1`,
              [action.subteamId, action.orgId],
            );
            if (!st.rowCount) throw new HttpError(400, "Subteam not found");
          }
          try {
            if (action.action === "ensure_calendar_feed") {
              const existing = await client.query<{ token: string }>(
                `SELECT token FROM calendar_feed_tokens
                 WHERE org_id = $1 AND user_id = $2 AND scope = $3
                   AND (($4::uuid IS NULL AND subteam_id IS NULL) OR subteam_id = $4::uuid)`,
                [action.orgId, userId, action.scope, action.subteamId],
              );
              if (existing.rows[0]) return { token: existing.rows[0].token, scope: action.scope };
            } else {
              await client.query(
                `DELETE FROM calendar_feed_tokens
                 WHERE org_id = $1 AND user_id = $2 AND scope = $3
                   AND (($4::uuid IS NULL AND subteam_id IS NULL) OR subteam_id = $4::uuid)`,
                [action.orgId, userId, action.scope, action.subteamId],
              );
            }
            const token = newFeedToken();
            await client.query(
              `INSERT INTO calendar_feed_tokens (token, org_id, user_id, scope, subteam_id)
               VALUES ($1, $2, $3, $4, $5)`,
              [token, action.orgId, userId, action.scope, action.subteamId],
            );
            return { token, scope: action.scope };
          } catch (error) {
            const message = error instanceof Error ? error.message : "";
            if (/calendar_feed_tokens|does not exist/i.test(message)) {
              throw new HttpError(503, "Apply the calendar feed migration first (0144_calendar_feed).");
            }
            throw error;
          }
        }

        case "disable_calendar_feed": {
          try {
            await client.query(
              `DELETE FROM calendar_feed_tokens
               WHERE org_id = $1 AND user_id = $2 AND scope = $3
                 AND (($4::uuid IS NULL AND subteam_id IS NULL) OR subteam_id = $4::uuid)`,
              [action.orgId, userId, action.scope, action.subteamId],
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "";
            if (/calendar_feed_tokens|does not exist/i.test(message)) {
              throw new HttpError(503, "Apply the calendar feed migration first (0144_calendar_feed).");
            }
            throw error;
          }
          return { ok: true };
        }

        default:
          throw new HttpError(400, "Unsupported calendar action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
