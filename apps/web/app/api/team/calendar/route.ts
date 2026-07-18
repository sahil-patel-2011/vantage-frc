import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  attendanceDateFromStart,
  defaultSeasonYear,
  parseSubteamCalendarAction,
  type CalendarEvent,
  type LinkableAttendance,
  type LinkablePractice,
  type Subteam,
  type SubteamCalendarView,
  type SubteamMemberLite,
} from "../../../../lib/subteam-calendar";

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

async function loadView(client: PoolClient, orgId: string, userId: string, role: string): Promise<SubteamCalendarView> {
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
      Omit<CalendarEvent, "attendanceEventTitle"> & { attendanceEventTitle: string | null }
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
    events: events.rows,
    mySubteamIds: membershipsByUser.get(userId) ?? [],
    attendanceEvents,
    practiceSessions,
  };
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");

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
      return loadView(client, row.orgId, session.user.id, row.role);
    });

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
          return { id: inserted.rows[0]!.id, attendanceEventId };
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
          const updated = await client.query(
            `UPDATE subteam_calendar_events SET ${sets.join(", ")}, updated_at = now()
             WHERE id = $1 AND org_id = $2`,
            values,
          );
          if (!updated.rowCount) throw new HttpError(404, "Event not found");
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

        default:
          throw new HttpError(400, "Unsupported calendar action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
