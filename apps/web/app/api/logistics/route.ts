import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  DEFAULT_MENTOR_CHECKLIST,
  DEFAULT_STUDENT_CHECKLIST,
  buildMyTrip,
  canManageLogistics,
  countLodgingGapsInTrips,
  findMyLodging,
  parseLogisticsAction,
  pickActiveOnDuty,
  pickNextTravelLeg,
  travelLegToCalendarKind,
  travelNotePrefix,
  type ChecklistItem,
  type EmergencyContact,
  type Hotel,
  type LogisticsMember,
  type LogisticsTrip,
  type LogisticsView,
  type OnDutySlot,
  type RoomAssignment,
  type TravelLeg,
} from "../../../lib/logistics";

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Authentication required");
  return session;
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Logistics request failed";
  if (/logistics_|relation .* does not exist/i.test(message)) {
    return Response.json({
      status: "setup_required",
      message: "Apply the event logistics migration first (0165_event_logistics_travel).",
    });
  }
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: message }, { status });
}

async function loadMySubteamIds(client: PoolClient, orgId: string, userId: string) {
  try {
    const rows = await client.query<{ subteamId: string }>(
      `SELECT subteam_id AS "subteamId" FROM team_subteam_members WHERE org_id = $1::uuid AND user_id = $2::uuid`,
      [orgId, userId],
    );
    return rows.rows.map((row) => row.subteamId);
  } catch {
    return [] as string[];
  }
}

async function loadView(client: PoolClient, userId: string, requestedOrg: string | null): Promise<LogisticsView> {
  const membership = await client.query<{
    orgId: string;
    orgName: string;
    teamNumber: number | null;
    role: string;
    teamRole: string | null;
    eventKey: string | null;
  }>(
    `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role,
            p.team_role AS "teamRole", c.active_event_key AS "eventKey"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     LEFT JOIN profiles p ON p.user_id = m.user_id
     LEFT JOIN org_active_context c ON c.org_id = o.id
     WHERE m.user_id = $1::uuid AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
     LIMIT 1`,
    [userId, requestedOrg],
  );
  const row = membership.rows[0];
  if (!row) return { status: "setup_required", message: "Select a team workspace to view lodging and travel.", context: {} };

  const orgId = row.orgId;
  const [tripRows, hotelRows, roomRows, legRows, checklistRows, contactRows, memberRows, onDutyRows, mySubteamIds] =
    await Promise.all([
      client.query(`SELECT id, title, event_key AS "eventKey", venue_name AS "venueName", venue_address AS "venueAddress",
        travel_notes AS "travelNotes", transport_notes AS "transportNotes", starts_on::text AS "startsOn", ends_on::text AS "endsOn"
        FROM logistics_trips WHERE org_id = $1::uuid ORDER BY starts_on DESC NULLS LAST, created_at DESC`, [orgId]),
      client.query(`SELECT id, trip_id AS "tripId", name, address, phone, confirmation_code AS "confirmationCode",
        check_in_at::text AS "checkInAt", check_out_at::text AS "checkOutAt", room_block_notes AS "roomBlockNotes", notes
        FROM logistics_hotels WHERE org_id = $1::uuid`, [orgId]),
      client.query<RoomAssignment>(`SELECT id, hotel_id AS "hotelId", room_label AS "roomLabel",
        occupant_user_id AS "occupantUserId", occupant_name AS "occupantName", notes FROM logistics_room_assignments WHERE org_id = $1::uuid`, [orgId]),
      client.query<TravelLeg>(`SELECT l.id, l.trip_id AS "tripId", l.kind, l.title, l.starts_at::text AS "startsAt", l.ends_at::text AS "endsAt",
        l.location, l.meeting_point AS "meetingPoint", l.notes, l.subteam_id AS "subteamId", st.name AS "subteamName",
        l.calendar_event_id AS "calendarEventId", l.sort_order AS "sortOrder"
        FROM logistics_travel_legs l LEFT JOIN team_subteams st ON st.id = l.subteam_id
        WHERE l.org_id = $1::uuid ORDER BY l.starts_at ASC, l.sort_order ASC`, [orgId]),
      client.query(`SELECT i.id, i.trip_id AS "tripId", i.audience, i.label, i.sort_order AS "sortOrder",
        (c.checked_at IS NOT NULL) AS checked, c.checked_at::text AS "checkedAt"
        FROM logistics_checklist_items i
        LEFT JOIN logistics_checklist_checks c ON c.item_id = i.id AND c.user_id = $2::uuid
        WHERE i.org_id = $1::uuid ORDER BY i.sort_order, i.created_at`, [orgId, userId]),
      client.query<EmergencyContact>(`SELECT id, name, role_label AS "roleLabel", phone, email, notes, is_primary AS "isPrimary", sort_order AS "sortOrder"
        FROM logistics_emergency_contacts WHERE org_id = $1::uuid ORDER BY sort_order, created_at`, [orgId]),
      client.query<LogisticsMember>(`SELECT m.user_id AS "userId", u.name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.org_id = $1::uuid ORDER BY lower(coalesce(u.name, u.email)) LIMIT 300`, [orgId]),
      client.query<OnDutySlot>(`SELECT id, trip_id AS "tripId", mentor_user_id AS "mentorUserId", mentor_name AS "mentorName", phone,
        starts_at::text AS "startsAt", ends_at::text AS "endsAt", location_note AS "locationNote", notes
        FROM logistics_on_duty WHERE org_id = $1::uuid ORDER BY starts_at ASC`, [orgId]),
      loadMySubteamIds(client, orgId, userId),
    ]);

  const roomsByHotel = new Map<string, RoomAssignment[]>();
  for (const room of roomRows.rows) {
    const list = roomsByHotel.get(room.hotelId) ?? [];
    list.push(room);
    roomsByHotel.set(room.hotelId, list);
  }
  const hotelsByTrip = new Map<string, Hotel[]>();
  for (const hotel of hotelRows.rows) {
    const entry: Hotel = { ...hotel, rooms: roomsByHotel.get(hotel.id) ?? [] };
    const list = hotelsByTrip.get(hotel.tripId) ?? [];
    list.push(entry);
    hotelsByTrip.set(hotel.tripId, list);
  }
  const legsByTrip = new Map<string, TravelLeg[]>();
  for (const leg of legRows.rows) {
    const list = legsByTrip.get(leg.tripId) ?? [];
    list.push(leg);
    legsByTrip.set(leg.tripId, list);
  }
  const trips: LogisticsTrip[] = tripRows.rows.map((trip) => ({ ...trip, hotels: hotelsByTrip.get(trip.id) ?? [], travelLegs: legsByTrip.get(trip.id) ?? [] }));
  const sharedChecklist: ChecklistItem[] = checklistRows.rows.map((item) => ({ ...item, checked: Boolean(item.checked), checkedAt: item.checkedAt }));
  const myTrip = buildMyTrip(trips, mySubteamIds, row.eventKey);

  return {
    status: "ready",
    context: {
      orgId,
      orgName: row.orgName,
      teamNumber: row.teamNumber,
      role: row.role,
      teamRole: row.teamRole,
      userId,
      canManage: canManageLogistics(row.role, row.teamRole),
      eventKey: row.eventKey,
    },
    trips,
    sharedChecklist,
    contacts: contactRows.rows,
    members: memberRows.rows,
    myLodging: findMyLodging(trips, userId),
    myTrip,
    nextLeg: pickNextTravelLeg(myTrip),
    activeOnDuty: pickActiveOnDuty(onDutyRows.rows),
    lodgingGaps: countLodgingGapsInTrips(trips),
  };
}

async function syncTravelLegCalendar(
  client: PoolClient,
  orgId: string,
  userId: string,
  legId: string,
  input: {
    title: string;
    kind: string;
    startsAt: string;
    endsAt: string | null;
    location: string;
    meetingPoint: string;
    notes: string;
    subteamId: string | null;
  },
) {
  const notes = [travelNotePrefix(input.kind as never), input.notes.trim()].filter(Boolean).join(" ");
  const description = [input.meetingPoint ? `Meet: ${input.meetingPoint}` : null, notes].filter(Boolean).join("\n");
  const existing = await client.query<{ calendarEventId: string | null }>(
    `SELECT calendar_event_id AS "calendarEventId" FROM logistics_travel_legs WHERE id = $1::uuid AND org_id = $2::uuid`,
    [legId, orgId],
  );
  const calendarEventId = existing.rows[0]?.calendarEventId ?? null;
  const kind = travelLegToCalendarKind(input.kind as never);
  if (calendarEventId) {
    await client.query(
      `UPDATE subteam_calendar_events SET title = $3, kind = $4, starts_at = $5::timestamptz, ends_at = $6::timestamptz,
       location = $7, notes = $8, subteam_id = $9::uuid, updated_at = now() WHERE id = $1::uuid AND org_id = $2::uuid`,
      [calendarEventId, orgId, input.title, kind, input.startsAt, input.endsAt, input.location, description, input.subteamId],
    );
    return calendarEventId;
  }
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO subteam_calendar_events (org_id, subteam_id, title, kind, starts_at, ends_at, location, notes, created_by)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8, $9::uuid) RETURNING id`,
    [orgId, input.subteamId, input.title, kind, input.startsAt, input.endsAt, input.location, description, userId],
  );
  const newId = inserted.rows[0]?.id;
  if (newId) {
    await client.query(`UPDATE logistics_travel_legs SET calendar_event_id = $3::uuid, updated_at = now() WHERE id = $1::uuid AND org_id = $2::uuid`, [
      legId,
      orgId,
      newId,
    ]);
  }
  return newId ?? null;
}

async function handleAction(client: PoolClient, userId: string, action: ReturnType<typeof parseLogisticsAction>) {
  const membership = await client.query<{ role: string; teamRole: string | null }>(
    `SELECT m.role, p.team_role AS "teamRole" FROM memberships m LEFT JOIN profiles p ON p.user_id = m.user_id
     WHERE m.org_id = $1::uuid AND m.user_id = $2::uuid LIMIT 1`,
    [action.orgId, userId],
  );
  const member = membership.rows[0];
  if (!member) throw new HttpError(403, "Organization membership required");
  const manage = canManageLogistics(member.role, member.teamRole);
  if (action.action !== "toggle_checklist" && !manage) throw new HttpError(403, "Mentors or team admins can update logistics plans");

  switch (action.action) {
    case "create_trip":
      await client.query(
        `INSERT INTO logistics_trips (org_id, title, event_key, venue_name, venue_address, travel_notes, transport_notes, starts_on, ends_on, created_by)
         VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10::uuid)`,
        [action.orgId, action.title, action.eventKey, action.venueName, action.venueAddress, action.travelNotes, action.transportNotes, action.startsOn, action.endsOn, userId],
      );
      return;
    case "delete_trip":
      await client.query(`DELETE FROM logistics_trips WHERE id = $1::uuid AND org_id = $2::uuid`, [action.id, action.orgId]);
      return;
    case "create_hotel":
      await client.query(
        `INSERT INTO logistics_hotels (org_id, trip_id, name, address, phone, confirmation_code, check_in_at, check_out_at, room_block_notes, notes, created_by)
         VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10,$11::uuid)`,
        [action.orgId, action.tripId, action.name, action.address, action.phone, action.confirmationCode, action.checkInAt, action.checkOutAt, action.roomBlockNotes, action.notes, userId],
      );
      return;
    case "delete_hotel":
      await client.query(`DELETE FROM logistics_hotels WHERE id = $1::uuid AND org_id = $2::uuid`, [action.id, action.orgId]);
      return;
    case "upsert_room":
      if (action.id) {
        await client.query(
          `UPDATE logistics_room_assignments SET room_label = $3, occupant_user_id = $4::uuid, occupant_name = $5, notes = $6
           WHERE id = $1::uuid AND org_id = $2::uuid AND hotel_id = $7::uuid`,
          [action.id, action.orgId, action.roomLabel, action.occupantUserId, action.occupantName, action.notes, action.hotelId],
        );
      } else {
        await client.query(
          `INSERT INTO logistics_room_assignments (org_id, hotel_id, room_label, occupant_user_id, occupant_name, notes, created_by)
           VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7::uuid)`,
          [action.orgId, action.hotelId, action.roomLabel, action.occupantUserId, action.occupantName, action.notes, userId],
        );
      }
      return;
    case "delete_room":
      await client.query(`DELETE FROM logistics_room_assignments WHERE id = $1::uuid AND org_id = $2::uuid`, [action.id, action.orgId]);
      return;
    case "seed_checklist": {
      const existing = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM logistics_checklist_items WHERE org_id = $1::uuid AND ($2::uuid IS NULL OR trip_id = $2::uuid)`,
        [action.orgId, action.tripId],
      );
      if (Number(existing.rows[0]?.count ?? 0) > 0) return;
      let order = 0;
      for (const label of DEFAULT_STUDENT_CHECKLIST) {
        await client.query(`INSERT INTO logistics_checklist_items (org_id, trip_id, audience, label, sort_order, created_by) VALUES ($1::uuid,$2::uuid,'student',$3,$4,$5::uuid)`, [
          action.orgId,
          action.tripId,
          label,
          order++,
          userId,
        ]);
      }
      for (const label of DEFAULT_MENTOR_CHECKLIST) {
        await client.query(`INSERT INTO logistics_checklist_items (org_id, trip_id, audience, label, sort_order, created_by) VALUES ($1::uuid,$2::uuid,'mentor',$3,$4,$5::uuid)`, [
          action.orgId,
          action.tripId,
          label,
          order++,
          userId,
        ]);
      }
      return;
    }
    case "add_checklist_item":
      await client.query(
        `INSERT INTO logistics_checklist_items (org_id, trip_id, audience, label, sort_order, created_by)
         VALUES ($1::uuid,$2::uuid,$3,$4,COALESCE((SELECT max(sort_order)+1 FROM logistics_checklist_items WHERE org_id = $1::uuid),0),$5::uuid)`,
        [action.orgId, action.tripId, action.audience, action.label, userId],
      );
      return;
    case "delete_checklist_item":
      await client.query(`DELETE FROM logistics_checklist_items WHERE id = $1::uuid AND org_id = $2::uuid`, [action.id, action.orgId]);
      return;
    case "toggle_checklist":
      if (action.checked) {
        await client.query(
          `INSERT INTO logistics_checklist_checks (org_id, item_id, user_id) VALUES ($1::uuid,$2::uuid,$3::uuid)
           ON CONFLICT (item_id, user_id) DO UPDATE SET checked_at = now()`,
          [action.orgId, action.id, userId],
        );
      } else {
        await client.query(`DELETE FROM logistics_checklist_checks WHERE org_id = $1::uuid AND item_id = $2::uuid AND user_id = $3::uuid`, [
          action.orgId,
          action.id,
          userId,
        ]);
      }
      return;
    case "upsert_contact":
      if (action.id) {
        await client.query(
          `UPDATE logistics_emergency_contacts SET name=$3, role_label=$4, phone=$5, email=$6, notes=$7, is_primary=$8, sort_order=$9
           WHERE id=$1::uuid AND org_id=$2::uuid`,
          [action.id, action.orgId, action.name, action.roleLabel, action.phone, action.email, action.notes, action.isPrimary, action.sortOrder],
        );
      } else {
        await client.query(
          `INSERT INTO logistics_emergency_contacts (org_id, name, role_label, phone, email, notes, is_primary, sort_order, created_by)
           VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9::uuid)`,
          [action.orgId, action.name, action.roleLabel, action.phone, action.email, action.notes, action.isPrimary, action.sortOrder, userId],
        );
      }
      return;
    case "delete_contact":
      await client.query(`DELETE FROM logistics_emergency_contacts WHERE id = $1::uuid AND org_id = $2::uuid`, [action.id, action.orgId]);
      return;
    case "upsert_on_duty":
      if (action.id) {
        await client.query(
          `UPDATE logistics_on_duty SET trip_id=$3::uuid, mentor_user_id=$4::uuid, mentor_name=$5, phone=$6, starts_at=$7::timestamptz,
           ends_at=$8::timestamptz, location_note=$9, notes=$10 WHERE id=$1::uuid AND org_id=$2::uuid`,
          [action.id, action.orgId, action.tripId, action.mentorUserId, action.mentorName, action.phone, action.startsAt, action.endsAt, action.locationNote, action.notes],
        );
      } else {
        await client.query(
          `INSERT INTO logistics_on_duty (org_id, trip_id, mentor_user_id, mentor_name, phone, starts_at, ends_at, location_note, notes, created_by)
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::timestamptz,$7::timestamptz,$8,$9,$10::uuid)`,
          [action.orgId, action.tripId, action.mentorUserId, action.mentorName, action.phone, action.startsAt, action.endsAt, action.locationNote, action.notes, userId],
        );
      }
      return;
    case "delete_on_duty":
      await client.query(`DELETE FROM logistics_on_duty WHERE id = $1::uuid AND org_id = $2::uuid`, [action.id, action.orgId]);
      return;
    case "upsert_travel_leg": {
      let legId = action.id;
      if (legId) {
        await client.query(
          `UPDATE logistics_travel_legs SET trip_id=$3::uuid, kind=$4, title=$5, starts_at=$6::timestamptz, ends_at=$7::timestamptz,
           location=$8, meeting_point=$9, notes=$10, subteam_id=$11::uuid, sort_order=$12, updated_at=now()
           WHERE id=$1::uuid AND org_id=$2::uuid`,
          [legId, action.orgId, action.tripId, action.kind, action.title, action.startsAt, action.endsAt, action.location, action.meetingPoint, action.notes, action.subteamId, action.sortOrder],
        );
      } else {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO logistics_travel_legs (org_id, trip_id, kind, title, starts_at, ends_at, location, meeting_point, notes, subteam_id, sort_order, created_by)
           VALUES ($1::uuid,$2::uuid,$3,$4,$5::timestamptz,$6::timestamptz,$7,$8,$9,$10::uuid,$11,$12::uuid) RETURNING id`,
          [action.orgId, action.tripId, action.kind, action.title, action.startsAt, action.endsAt, action.location, action.meetingPoint, action.notes, action.subteamId, action.sortOrder, userId],
        );
        legId = inserted.rows[0]?.id ?? null;
      }
      if (!legId) throw new HttpError(500, "Travel leg was not saved");
      try {
        await syncTravelLegCalendar(client, action.orgId, userId, legId, action);
      } catch {
        /* calendar optional */
      }
      return;
    }
    case "delete_travel_leg": {
      const row = await client.query<{ calendarEventId: string | null }>(
        `SELECT calendar_event_id AS "calendarEventId" FROM logistics_travel_legs WHERE id = $1::uuid AND org_id = $2::uuid`,
        [action.id, action.orgId],
      );
      const calendarEventId = row.rows[0]?.calendarEventId;
      await client.query(`DELETE FROM logistics_travel_legs WHERE id = $1::uuid AND org_id = $2::uuid`, [action.id, action.orgId]);
      if (calendarEventId) {
        try {
          await client.query(`DELETE FROM subteam_calendar_events WHERE id = $1::uuid AND org_id = $2::uuid`, [calendarEventId, action.orgId]);
        } catch {
          /* optional */
        }
      }
      return;
    }
    default:
      throw new HttpError(400, "Unsupported logistics action");
  }
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const requestedOrg = new URL(request.url).searchParams.get("orgId");
    const view = await withRls({ userId: session.user.id }, (client) => loadView(client, session.user.id, requestedOrg));
    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseLogisticsAction(await request.json());
    await withRls({ userId: session.user.id, orgId: action.orgId }, (client) => handleAction(client, session.user.id, action));
    const view = await withRls({ userId: session.user.id, orgId: action.orgId }, (client) => loadView(client, session.user.id, action.orgId));
    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}
