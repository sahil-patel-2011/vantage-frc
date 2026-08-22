import type { PoolClient } from "@neondatabase/serverless";
import { randomBytes } from "node:crypto";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { buildCalendar, type CalendarIcsEvent } from "../../../../lib/calendar-ics";
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
    client.query<
      Omit<CalendarEvent, "myRsvp" | "rsvpGoing" | "rsvpMaybe" | "rsvpNo">
    >(
      `SELECT e.id, e.title, e.kind, e.starts_at::text AS "startsAt", e.ends_at::text AS "endsAt",
              e.location, e.notes, e.subteam_id AS "subteamId",
              st.name AS "subteamName", st.color AS "subteamColor",
              e.attendance_event_id AS "attendanceEventId",
              ae.title AS "attendanceEventTitle",
              e.milestone_id AS "milestoneId",
              e.driver_session_id AS "driverSessionId",
              cb.name AS "createdByName"
       FROM subteam_calendar_events e
       LEFT JOIN team_subteams st ON st.id = e.subteam_id
       LEFT JOIN attendance_events ae ON ae.id = e.attendance_event_id
       LEFT JOIN users cb ON cb.id = e.created_by
       WHERE e.org_id = $1
         AND e.starts_at > now() - interval '120 days'
       ORDER BY e.starts_at ASC
       LIMIT 800`,
      [orgId],
    ),
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

  const eventRows: CalendarEvent[] = events.rows.map((row) => {
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
    attendanceEvents = [];
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
    practiceSessions = [];
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
    duties = [];
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
    travelLegs = [];
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

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseSubteamCalendarAction(await request.json());
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
          const eventId = inserted.rows[0]!.id;
          try {
            await notifyCalendarEvent(client, {
              orgId: action.orgId,
              actorUserId: userId,
              eventId,
              title: action.title,
              subteamId: action.subteamId,
              mode: "created",
            });
          } catch {
            // Inbox notify is best-effort; event creation still succeeds.
          }
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
          try {
            await notifyCalendarEvent(client, {
              orgId: action.orgId,
              actorUserId: userId,
              eventId: action.id,
              title: row.title,
              subteamId: row.subteamId,
              mode: "updated",
            });
          } catch {
            // Inbox notify is best-effort; event update still succeeds.
          }
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
