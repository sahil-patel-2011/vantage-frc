import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { notifyCalendarEvent } from "../../../lib/notify-calendar";
import {
  calendarTitleForVisit,
  canManageVisits,
  countHostGaps,
  parseVisitInviteAction,
  sortVisits,
  upcomingVisitCount,
  type VisitDemo,
  type VisitHost,
  type VisitInvite,
  type VisitInvitesView,
  type VisitKind,
  type VisitRsvp,
  type VisitStatus,
} from "../../../lib/visit-invites";

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

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Visit invites request failed";
  if (/visit_invite|relation .* does not exist/i.test(message)) {
    return Response.json(
      {
        error: "Apply the visit invites migration first (0177_visit_invites).",
        status: "setup_required",
      },
      { status: 503 },
    );
  }
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: message }, { status });
}

async function loadView(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<VisitInvitesView> {
  const membership = await client.query<{
    orgId: string;
    orgName: string;
    role: string;
    teamRole: string | null;
  }>(
    `SELECT m.org_id AS "orgId", o.name AS "orgName", m.role,
            p.team_role AS "teamRole"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     LEFT JOIN profiles p ON p.user_id = m.user_id
     WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
     LIMIT 1`,
    [userId, requestedOrg],
  );
  const org = membership.rows[0];
  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to plan shop tours and demo days.",
      context: { orgId: null, orgName: null },
    };
  }

  const visitsQ = await client.query<{
    id: string;
    title: string;
    kind: VisitKind;
    startsAt: string;
    endsAt: string | null;
    location: string;
    description: string;
    capacity: number | null;
    status: VisitStatus;
    calendarEventId: string | null;
    createdBy: string;
    createdByName: string | null;
  }>(
    `SELECT v.id::text AS id, v.title, v.kind, v.starts_at::text AS "startsAt",
            v.ends_at::text AS "endsAt", v.location, v.description, v.capacity,
            v.status, v.calendar_event_id::text AS "calendarEventId",
            v.created_by::text AS "createdBy", u.name AS "createdByName"
     FROM visit_invites v
     LEFT JOIN users u ON u.id = v.created_by
     WHERE v.org_id = $1::uuid
     ORDER BY v.starts_at ASC
     LIMIT 200`,
    [org.orgId],
  );

  const [hostsQ, demosQ, rsvpsQ] = await Promise.all([
    client.query<VisitHost>(
      `SELECT id::text AS id, visit_id::text AS "visitId", user_id::text AS "userId",
              host_name AS "hostName", notes, created_by::text AS "createdBy"
       FROM visit_invite_hosts WHERE org_id = $1::uuid`,
      [org.orgId],
    ),
    client.query<VisitDemo>(
      `SELECT id::text AS id, visit_id::text AS "visitId", user_id::text AS "userId",
              student_name AS "studentName", demo_title AS "demoTitle", notes,
              sort_order AS "sortOrder", created_by::text AS "createdBy"
       FROM visit_invite_demos WHERE org_id = $1::uuid
       ORDER BY sort_order, created_at`,
      [org.orgId],
    ),
    client.query<VisitRsvp>(
      `SELECT id::text AS id, visit_id::text AS "visitId", user_id::text AS "userId",
              guest_name AS "guestName", guest_email AS "guestEmail", party_size AS "partySize",
              response, note, created_by::text AS "createdBy",
              responded_at::text AS "respondedAt"
       FROM visit_invite_rsvps WHERE org_id = $1::uuid`,
      [org.orgId],
    ),
  ]);

  const hostsByVisit = new Map<string, VisitHost[]>();
  for (const row of hostsQ.rows) {
    const list = hostsByVisit.get(row.visitId) ?? [];
    list.push(row);
    hostsByVisit.set(row.visitId, list);
  }
  const demosByVisit = new Map<string, VisitDemo[]>();
  for (const row of demosQ.rows) {
    const list = demosByVisit.get(row.visitId) ?? [];
    list.push(row);
    demosByVisit.set(row.visitId, list);
  }
  const rsvpsByVisit = new Map<string, VisitRsvp[]>();
  for (const row of rsvpsQ.rows) {
    const list = rsvpsByVisit.get(row.visitId) ?? [];
    list.push(row);
    rsvpsByVisit.set(row.visitId, list);
  }

  const visits: VisitInvite[] = visitsQ.rows.map((row) => {
    const rsvps = rsvpsByVisit.get(row.id) ?? [];
    const mine = rsvps.find((r) => r.userId === userId);
    return {
      ...row,
      hosts: hostsByVisit.get(row.id) ?? [],
      demos: demosByVisit.get(row.id) ?? [],
      rsvps,
      myRsvp: mine?.response ?? null,
    };
  });

  const sorted = sortVisits(visits);
  return {
    status: "ready",
    context: {
      orgId: org.orgId,
      orgName: org.orgName,
      role: org.role,
      teamRole: org.teamRole,
      userId,
      canManage: canManageVisits({ role: org.role, teamRole: org.teamRole }),
    },
    visits: sorted,
    upcomingCount: upcomingVisitCount(sorted),
    hostGaps: countHostGaps(sorted),
  };
}

async function syncVisitCalendar(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    visitId: string;
    title: string;
    kind: VisitKind;
    startsAt: string;
    endsAt: string | null;
    location: string;
    description: string;
    calendarEventId: string | null;
  },
): Promise<string> {
  const calTitle = calendarTitleForVisit({ title: input.title, kind: input.kind });
  const notes = [input.description, "Linked from Visit invites"].filter(Boolean).join("\n\n");

  if (input.calendarEventId) {
    const updated = await client.query(
      `UPDATE subteam_calendar_events
       SET title = $3, kind = 'outreach', starts_at = $4::timestamptz,
           ends_at = $5::timestamptz, location = $6, notes = $7, updated_at = now()
       WHERE id = $1::uuid AND org_id = $2::uuid`,
      [input.calendarEventId, input.orgId, calTitle, input.startsAt, input.endsAt, input.location, notes],
    );
    if (updated.rowCount) {
      // Savepointed inside notifyCalendarEvent: a failed fan-out must not take
      // the calendar row (and the visit invite pointing at it) down with it.
      await notifyCalendarEvent(client, {
        orgId: input.orgId,
        actorUserId: input.userId,
        eventId: input.calendarEventId,
        title: calTitle,
        subteamId: null,
        mode: "updated",
      });
      return input.calendarEventId;
    }
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO subteam_calendar_events
       (org_id, subteam_id, title, kind, starts_at, ends_at, location, notes, created_by)
     VALUES ($1::uuid, NULL, $2, 'outreach', $3::timestamptz, $4::timestamptz, $5, $6, $7::uuid)
     RETURNING id::text AS id`,
    [input.orgId, calTitle, input.startsAt, input.endsAt, input.location, notes, input.userId],
  );
  const eventId = inserted.rows[0]!.id;
  await client.query(
    `UPDATE visit_invites SET calendar_event_id = $1::uuid, updated_at = now()
     WHERE id = $2::uuid AND org_id = $3::uuid`,
    [eventId, input.visitId, input.orgId],
  );
  await notifyCalendarEvent(client, {
    orgId: input.orgId,
    actorUserId: input.userId,
    eventId,
    title: calTitle,
    subteamId: null,
    mode: "created",
  });
  return eventId;
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const requestedOrg = new URL(request.url).searchParams.get("orgId");
    const view = await withRls({ userId: session.user.id }, (client) =>
      loadView(client, session.user.id, requestedOrg),
    );
    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseVisitInviteAction(await request.json());
    const userId = session.user.id;

    const view = await withRls({ userId, orgId: action.orgId }, async (client) => {
      const membership = await client.query<{ role: string; teamRole: string | null }>(
        `SELECT m.role, p.team_role AS "teamRole"
         FROM memberships m
         LEFT JOIN profiles p ON p.user_id = m.user_id
         WHERE m.org_id = $1::uuid AND m.user_id = $2::uuid
         LIMIT 1`,
        [action.orgId, userId],
      );
      const member = membership.rows[0];
      if (!member) throw new HttpError(403, "Organization membership required");
      const manage = canManageVisits({ role: member.role, teamRole: member.teamRole });

      switch (action.action) {
        case "upsert_visit": {
          if (!manage) throw new HttpError(403, "Only mentors, coaches, and admins can schedule visits");
          let visitId = action.id ?? null;
          if (visitId) {
            const updated = await client.query(
              `UPDATE visit_invites
               SET title = $3, kind = $4, starts_at = $5::timestamptz, ends_at = $6::timestamptz,
                   location = $7, description = $8, capacity = $9, status = $10, updated_at = now()
               WHERE id = $1::uuid AND org_id = $2::uuid`,
              [
                visitId, action.orgId, action.title, action.kind, action.startsAt, action.endsAt,
                action.location, action.description, action.capacity, action.status,
              ],
            );
            if (!updated.rowCount) throw new HttpError(404, "Visit not found");
          } else {
            const inserted = await client.query<{ id: string }>(
              `INSERT INTO visit_invites
                 (org_id, title, kind, starts_at, ends_at, location, description, capacity, status, created_by)
               VALUES ($1::uuid, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, $10::uuid)
               RETURNING id::text AS id`,
              [
                action.orgId, action.title, action.kind, action.startsAt, action.endsAt,
                action.location, action.description, action.capacity, action.status, userId,
              ],
            );
            visitId = inserted.rows[0]!.id;
          }

          if (action.syncToCalendar && visitId) {
            const current = await client.query<{ calendarEventId: string | null }>(
              `SELECT calendar_event_id::text AS "calendarEventId"
               FROM visit_invites WHERE id = $1::uuid AND org_id = $2::uuid`,
              [visitId, action.orgId],
            );
            await syncVisitCalendar(client, {
              orgId: action.orgId,
              userId,
              visitId,
              title: action.title,
              kind: action.kind,
              startsAt: action.startsAt,
              endsAt: action.endsAt,
              location: action.location,
              description: action.description,
              calendarEventId: current.rows[0]?.calendarEventId ?? null,
            });
          }
          break;
        }
        case "delete_visit": {
          if (!manage) throw new HttpError(403, "Only mentors, coaches, and admins can delete visits");
          const deleted = await client.query(
            `DELETE FROM visit_invites WHERE id = $1::uuid AND org_id = $2::uuid`,
            [action.id, action.orgId],
          );
          if (!deleted.rowCount) throw new HttpError(404, "Visit not found");
          break;
        }
        case "add_host": {
          if (!manage) throw new HttpError(403, "Only mentors, coaches, and admins can add hosts");
          if (!action.userId && !action.hostName.trim()) {
            throw new HttpError(400, "Host name or member is required");
          }
          await client.query(
            `INSERT INTO visit_invite_hosts
               (org_id, visit_id, user_id, host_name, notes, created_by)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid)`,
            [action.orgId, action.visitId, action.userId, action.hostName, action.notes, userId],
          );
          break;
        }
        case "remove_host": {
          if (!manage) throw new HttpError(403, "Only mentors, coaches, and admins can remove hosts");
          const deleted = await client.query(
            `DELETE FROM visit_invite_hosts WHERE id = $1::uuid AND org_id = $2::uuid`,
            [action.id, action.orgId],
          );
          if (!deleted.rowCount) throw new HttpError(404, "Host not found");
          break;
        }
        case "add_demo": {
          if (!manage) throw new HttpError(403, "Only mentors, coaches, and admins can add demos");
          await client.query(
            `INSERT INTO visit_invite_demos
               (org_id, visit_id, user_id, student_name, demo_title, notes, sort_order, created_by)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::uuid)`,
            [
              action.orgId, action.visitId, action.userId, action.studentName,
              action.demoTitle, action.notes, action.sortOrder, userId,
            ],
          );
          break;
        }
        case "remove_demo": {
          if (!manage) throw new HttpError(403, "Only mentors, coaches, and admins can remove demos");
          const deleted = await client.query(
            `DELETE FROM visit_invite_demos WHERE id = $1::uuid AND org_id = $2::uuid`,
            [action.id, action.orgId],
          );
          if (!deleted.rowCount) throw new HttpError(404, "Demo not found");
          break;
        }
        case "set_rsvp": {
          const guestOnly = Boolean(action.guestName.trim()) && action.userId == null;
          const targetUserId = guestOnly ? null : (action.userId ?? userId);
          const isSelf = targetUserId === userId;
          if (!isSelf && !guestOnly && !manage) {
            throw new HttpError(403, "You can only RSVP for yourself unless you manage visits");
          }
          if (!targetUserId && !action.guestName.trim()) {
            throw new HttpError(400, "Guest name is required for external RSVPs");
          }

          if (targetUserId) {
            const existing = await client.query<{ id: string }>(
              `SELECT id::text AS id FROM visit_invite_rsvps
               WHERE org_id = $1::uuid AND visit_id = $2::uuid AND user_id = $3::uuid
               LIMIT 1`,
              [action.orgId, action.visitId, targetUserId],
            );
            if (existing.rows[0]) {
              await client.query(
                `UPDATE visit_invite_rsvps
                 SET response = $3, party_size = $4, guest_name = $5, guest_email = $6,
                     note = $7, responded_at = now()
                 WHERE id = $1::uuid AND org_id = $2::uuid`,
                [
                  existing.rows[0].id, action.orgId, action.response, action.partySize,
                  action.guestName, action.guestEmail, action.note,
                ],
              );
            } else {
              await client.query(
                `INSERT INTO visit_invite_rsvps
                   (org_id, visit_id, user_id, guest_name, guest_email, party_size, response, note, created_by, responded_at)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9::uuid, now())`,
                [
                  action.orgId, action.visitId, targetUserId, action.guestName, action.guestEmail,
                  action.partySize, action.response, action.note, userId,
                ],
              );
            }
          } else {
            await client.query(
              `INSERT INTO visit_invite_rsvps
                 (org_id, visit_id, user_id, guest_name, guest_email, party_size, response, note, created_by, responded_at)
               VALUES ($1::uuid, $2::uuid, NULL, $3, $4, $5, $6, $7, $8::uuid, now())`,
              [
                action.orgId, action.visitId, action.guestName, action.guestEmail,
                action.partySize, action.response, action.note, userId,
              ],
            );
          }
          break;
        }
        case "remove_rsvp": {
          const existing = await client.query<{ userId: string | null; createdBy: string }>(
            `SELECT user_id::text AS "userId", created_by::text AS "createdBy"
             FROM visit_invite_rsvps WHERE id = $1::uuid AND org_id = $2::uuid`,
            [action.id, action.orgId],
          );
          const row = existing.rows[0];
          if (!row) throw new HttpError(404, "RSVP not found");
          const allowed = row.userId === userId || row.createdBy === userId || manage;
          if (!allowed) throw new HttpError(403, "You cannot remove this RSVP");
          await client.query(
            `DELETE FROM visit_invite_rsvps WHERE id = $1::uuid AND org_id = $2::uuid`,
            [action.id, action.orgId],
          );
          break;
        }
        default:
          throw new HttpError(400, "Unknown action");
      }

      return loadView(client, userId, action.orgId);
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}
