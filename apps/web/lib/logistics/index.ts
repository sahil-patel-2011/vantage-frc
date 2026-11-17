// Event logistics — trips, lodging, checklists, on-duty mentors, and timed travel legs.
// Framework-free domain logic for the API route, UI, calendar, and unit tests.

export const CHECKLIST_AUDIENCES = ["student", "mentor", "all"] as const;
export type ChecklistAudience = (typeof CHECKLIST_AUDIENCES)[number];

export const AUDIENCE_LABEL: Record<ChecklistAudience, string> = {
  student: "Students",
  mentor: "Mentors",
  all: "Everyone",
};

export const DEFAULT_STUDENT_CHECKLIST = [
  "Photo ID and team badge",
  "Closed-toe shoes and safety glasses",
  "Phone charger and portable battery",
  "Medications and allergy info",
  "Cash or card for food",
  "Know your hotel room and meeting point",
] as const;

export const DEFAULT_MENTOR_CHECKLIST = [
  "Emergency contacts posted for students",
  "Hotel block and rooming list confirmed",
  "Travel legs published on Team Calendar",
  "On-duty mentor schedule posted",
  "Transportation and parking plan shared",
] as const;

export const TRAVEL_LEG_KINDS = [
  "depart_home",
  "arrive_hotel",
  "depart_hotel",
  "arrive_venue",
  "depart_venue",
  "return_home",
] as const;
export type TravelLegKind = (typeof TRAVEL_LEG_KINDS)[number];

export const TRAVEL_LEG_LABELS: Record<TravelLegKind, string> = {
  depart_home: "Leave home / school",
  arrive_hotel: "Arrive at hotel",
  depart_hotel: "Leave hotel",
  arrive_venue: "Arrive at venue",
  depart_venue: "Leave venue",
  return_home: "Return home",
};

export const TRAVEL_LEG_DEFAULT_TITLES: Record<TravelLegKind, string> = {
  depart_home: "Depart for event",
  arrive_hotel: "Hotel check-in",
  depart_hotel: "Leave for venue",
  arrive_venue: "Arrive at competition",
  depart_venue: "Leave venue",
  return_home: "Head home",
};

export type LogisticsMember = {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
};

export type RoomAssignment = {
  id: string;
  hotelId: string;
  roomLabel: string;
  occupantUserId: string | null;
  occupantName: string;
  notes: string;
};

export type Hotel = {
  id: string;
  tripId: string;
  name: string;
  address: string;
  phone: string;
  confirmationCode: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  roomBlockNotes: string;
  notes: string;
  rooms: RoomAssignment[];
};

export type ChecklistItem = {
  id: string;
  tripId: string | null;
  audience: ChecklistAudience;
  label: string;
  sortOrder: number;
  checked: boolean;
  checkedAt: string | null;
};

export type EmergencyContact = {
  id: string;
  name: string;
  roleLabel: string;
  phone: string;
  email: string;
  notes: string;
  isPrimary: boolean;
  sortOrder: number;
};

export type OnDutySlot = {
  id: string;
  tripId: string | null;
  mentorUserId: string | null;
  mentorName: string;
  phone: string;
  startsAt: string;
  endsAt: string | null;
  locationNote: string;
  notes: string;
};

export type TravelLeg = {
  id: string;
  tripId: string;
  kind: TravelLegKind;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string;
  meetingPoint: string;
  notes: string;
  subteamId: string | null;
  subteamName: string | null;
  calendarEventId: string | null;
  sortOrder: number;
};

export type LogisticsTrip = {
  id: string;
  title: string;
  eventKey: string | null;
  venueName: string;
  venueAddress: string;
  travelNotes: string;
  transportNotes: string;
  startsOn: string | null;
  endsOn: string | null;
  hotels: Hotel[];
  travelLegs: TravelLeg[];
};

export type MyLodging = {
  hotelId: string;
  hotelName: string;
  hotelAddress: string;
  hotelPhone: string;
  roomLabel: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  tripId: string;
  tripTitle: string;
};

export type MyTripStop = {
  id: string;
  tripId: string;
  tripTitle: string;
  kind: TravelLegKind;
  label: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string;
  meetingPoint: string;
  notes: string;
};

export type LogisticsContext = {
  orgId: string;
  orgName: string;
  teamNumber: number | null;
  role: string;
  teamRole: string | null;
  userId: string;
  canManage: boolean;
  eventKey: string | null;
};

export type LogisticsView =
  | {
      status: "ready";
      context: LogisticsContext;
      trips: LogisticsTrip[];
      sharedChecklist: ChecklistItem[];
      contacts: EmergencyContact[];
      members: LogisticsMember[];
      myLodging: MyLodging | null;
      myTrip: MyTripStop[];
      nextLeg: MyTripStop | null;
      activeOnDuty: OnDutySlot | null;
      lodgingGaps: number;
    }
  | { status: "setup_required"; message: string; context: Partial<LogisticsContext> };

export type LogisticsRoom = {
  id: string;
  hotelId: string;
  hotelName: string;
  roomLabel: string;
  occupantUserId: string | null;
  occupantName: string;
  notes: string;
};

export function roomNeedsOccupant(room: Pick<LogisticsRoom, "occupantUserId" | "occupantName">): boolean {
  return !room.occupantUserId && !room.occupantName.trim();
}

export function countLodgingGaps(
  rooms: Array<Pick<LogisticsRoom, "occupantUserId" | "occupantName">>,
): number {
  return rooms.filter(roomNeedsOccupant).length;
}

export function countLodgingGapsInTrips(trips: LogisticsTrip[]): number {
  const rooms: LogisticsRoom[] = [];
  for (const trip of trips) {
    for (const hotel of trip.hotels) {
      for (const room of hotel.rooms) {
        rooms.push({
          id: room.id,
          hotelId: hotel.id,
          hotelName: hotel.name,
          roomLabel: room.roomLabel,
          occupantUserId: room.occupantUserId,
          occupantName: room.occupantName,
          notes: room.notes,
        });
      }
    }
  }
  return countLodgingGaps(rooms);
}

export function myRoomForUser(rooms: LogisticsRoom[], userId: string): LogisticsRoom | null {
  return rooms.find((room) => room.occupantUserId === userId) ?? null;
}

export function unsignedChecklistTone(unsignedCount: number): "ok" | "warn" | "neutral" {
  if (unsignedCount <= 0) return "ok";
  return "warn";
}

const ADMIN_ROLES = new Set(["owner", "admin"]);
const MENTOR_TEAM_ROLES = new Set(["mentor", "coach"]);

export function canManageLogistics(membershipRole: string, teamRole: string | null): boolean {
  if (ADMIN_ROLES.has(membershipRole)) return true;
  if (teamRole && MENTOR_TEAM_ROLES.has(teamRole)) return true;
  return false;
}

export function checklistLens(teamRole: string | null): "student" | "mentor" {
  if (teamRole && MENTOR_TEAM_ROLES.has(teamRole)) return "mentor";
  return "student";
}

export function filterChecklistForViewer(items: ChecklistItem[], teamRole: string | null): ChecklistItem[] {
  const lens = checklistLens(teamRole);
  return items.filter((item) => item.audience === "all" || item.audience === lens);
}

export function findMyLodging(trips: LogisticsTrip[], userId: string): MyLodging | null {
  for (const trip of trips) {
    for (const hotel of trip.hotels) {
      const room = hotel.rooms.find((entry) => entry.occupantUserId === userId);
      if (room) {
        return {
          hotelId: hotel.id,
          hotelName: hotel.name,
          hotelAddress: hotel.address,
          hotelPhone: hotel.phone,
          roomLabel: room.roomLabel,
          checkInAt: hotel.checkInAt,
          checkOutAt: hotel.checkOutAt,
          tripId: trip.id,
          tripTitle: trip.title,
        };
      }
    }
  }
  return null;
}

export function pickActiveOnDuty(slots: OnDutySlot[], now: Date = new Date()): OnDutySlot | null {
  if (!slots.length) return null;
  const t = now.getTime();
  const active = slots.find((slot) => {
    const start = new Date(slot.startsAt).getTime();
    const end = slot.endsAt ? new Date(slot.endsAt).getTime() : Number.POSITIVE_INFINITY;
    return Number.isFinite(start) && start <= t && t <= end;
  });
  if (active) return active;
  return (
    [...slots]
      .filter((slot) => new Date(slot.startsAt).getTime() > t)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] ?? null
  );
}

export function checklistProgress(items: ChecklistItem[]): { total: number; done: number; percent: number } {
  const total = items.length;
  const done = items.filter((item) => item.checked).length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return { total, done, percent };
}

export function groupRoomsByLabel(rooms: LogisticsRoom[]): Map<string, LogisticsRoom[]> {
  const map = new Map<string, LogisticsRoom[]>();
  for (const room of rooms) {
    const key = room.roomLabel.trim() || "Room";
    const list = map.get(key) ?? [];
    list.push(room);
    map.set(key, list);
  }
  return map;
}

export function isTravelLegKind(value: unknown): value is TravelLegKind {
  return typeof value === "string" && (TRAVEL_LEG_KINDS as readonly string[]).includes(value);
}

export function defaultTravelLegTitle(kind: TravelLegKind): string {
  return TRAVEL_LEG_DEFAULT_TITLES[kind];
}

export function sortTravelLegs<T extends Pick<TravelLeg, "startsAt" | "sortOrder" | "title">>(legs: T[]): T[] {
  return [...legs].sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
  );
}

export function filterTravelLegsForSubteams<T extends Pick<TravelLeg, "subteamId">>(
  legs: T[],
  mySubteamIds: string[],
): T[] {
  if (mySubteamIds.length === 0) {
    return legs.filter((leg) => leg.subteamId == null);
  }
  const mine = new Set(mySubteamIds);
  return legs.filter((leg) => leg.subteamId == null || mine.has(leg.subteamId));
}

export function buildMyTrip(
  trips: LogisticsTrip[],
  mySubteamIds: string[],
  eventKey: string | null,
): MyTripStop[] {
  const stops: MyTripStop[] = [];
  for (const trip of trips) {
    if (eventKey && trip.eventKey && trip.eventKey !== eventKey) continue;
    const legs = filterTravelLegsForSubteams(trip.travelLegs, mySubteamIds);
    for (const leg of sortTravelLegs(legs)) {
      stops.push({
        id: leg.id,
        tripId: trip.id,
        tripTitle: trip.title,
        kind: leg.kind,
        label: TRAVEL_LEG_LABELS[leg.kind],
        title: leg.title || defaultTravelLegTitle(leg.kind),
        startsAt: leg.startsAt,
        endsAt: leg.endsAt,
        location: leg.location,
        meetingPoint: leg.meetingPoint,
        notes: leg.notes,
      });
    }
  }
  return sortTravelLegs(
    stops.map((stop, index) => ({
      startsAt: stop.startsAt,
      sortOrder: index,
      title: stop.title,
      stop,
    })),
  ).map((row) => row.stop);
}

export function pickNextTravelLeg(stops: MyTripStop[], now: Date = new Date()): MyTripStop | null {
  const t = now.getTime();
  return (
    [...stops]
      .filter((stop) => {
        const start = new Date(stop.startsAt).getTime();
        return Number.isFinite(start) && start >= t - 30 * 60_000;
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] ?? null
  );
}

export function travelLegToCalendarKind(_kind: TravelLegKind): "event" {
  return "event";
}

export function travelNotePrefix(kind: TravelLegKind): string {
  return `Travel:${kind}`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredText(value: unknown, label: string, max: number): string {
  if (value == null || String(value).trim() === "") throw new Error(`${label} is required`);
  const text = String(value).trim();
  if (text.length > max) throw new Error(`${label} is too long`);
  return text;
}

function optionalText(value: unknown, max: number): string {
  if (value == null) return "";
  const text = String(value).trim();
  if (text.length > max) throw new Error("Text is too long");
  return text;
}

function uuid(value: unknown, label: string): string {
  const text = requiredText(value, label, 64);
  if (!UUID_RE.test(text)) throw new Error(`${label} must be a valid id`);
  return text;
}

function optionalUuid(value: unknown, label: string): string | null {
  if (value == null || String(value).trim() === "") return null;
  return uuid(value, label);
}

function isoDateTime(value: unknown, label: string): string {
  const text = requiredText(value, label, 64);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date/time`);
  return date.toISOString();
}

function optionalIsoDateTime(value: unknown, label: string): string | null {
  if (value == null || String(value).trim() === "") return null;
  return isoDateTime(value, label);
}

function optionalIsoDate(value: unknown, label: string): string | null {
  if (value == null || String(value).trim() === "") return null;
  const text = requiredText(value, label, 40);
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (!match) throw new Error(`${label} must be YYYY-MM-DD`);
  return text;
}

function parseAudience(value: unknown): ChecklistAudience {
  const text = requiredText(value ?? "all", "Audience", 16);
  if (!(CHECKLIST_AUDIENCES as readonly string[]).includes(text)) {
    throw new Error("Audience must be student, mentor, or all");
  }
  return text as ChecklistAudience;
}

function parseTravelKind(value: unknown): TravelLegKind {
  const text = requiredText(value, "Travel leg kind", 32);
  if (!isTravelLegKind(text)) throw new Error("Invalid travel leg kind");
  return text;
}

export type LogisticsAction =
  | { action: "create_trip"; orgId: string; title: string; eventKey: string | null; venueName: string; venueAddress: string; travelNotes: string; transportNotes: string; startsOn: string | null; endsOn: string | null }
  | { action: "delete_trip"; orgId: string; id: string }
  | { action: "create_hotel"; orgId: string; tripId: string; name: string; address: string; phone: string; confirmationCode: string; checkInAt: string | null; checkOutAt: string | null; roomBlockNotes: string; notes: string }
  | { action: "delete_hotel"; orgId: string; id: string }
  | { action: "upsert_room"; orgId: string; hotelId: string; id: string | null; roomLabel: string; occupantUserId: string | null; occupantName: string; notes: string }
  | { action: "delete_room"; orgId: string; id: string }
  | { action: "seed_checklist"; orgId: string; tripId: string | null }
  | { action: "add_checklist_item"; orgId: string; tripId: string | null; audience: ChecklistAudience; label: string }
  | { action: "delete_checklist_item"; orgId: string; id: string }
  | { action: "toggle_checklist"; orgId: string; id: string; checked: boolean }
  | { action: "upsert_contact"; orgId: string; id: string | null; name: string; roleLabel: string; phone: string; email: string; notes: string; isPrimary: boolean; sortOrder: number }
  | { action: "delete_contact"; orgId: string; id: string }
  | { action: "upsert_on_duty"; orgId: string; id: string | null; tripId: string | null; mentorUserId: string | null; mentorName: string; phone: string; startsAt: string; endsAt: string | null; locationNote: string; notes: string }
  | { action: "delete_on_duty"; orgId: string; id: string }
  | {
      action: "upsert_travel_leg";
      orgId: string;
      id: string | null;
      tripId: string;
      kind: TravelLegKind;
      title: string;
      startsAt: string;
      endsAt: string | null;
      location: string;
      meetingPoint: string;
      notes: string;
      subteamId: string | null;
      sortOrder: number;
    }
  | { action: "delete_travel_leg"; orgId: string; id: string };

export function parseLogisticsAction(input: unknown): LogisticsAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid logistics action");
  }
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  const orgId = uuid(body.orgId, "Organization");

  switch (action) {
    case "create_trip":
      return {
        action,
        orgId,
        title: requiredText(body.title, "Trip title", 200),
        eventKey: body.eventKey == null || String(body.eventKey).trim() === "" ? null : optionalText(body.eventKey, 80),
        venueName: optionalText(body.venueName, 200),
        venueAddress: optionalText(body.venueAddress, 400),
        travelNotes: optionalText(body.travelNotes, 4000),
        transportNotes: optionalText(body.transportNotes, 4000),
        startsOn: optionalIsoDate(body.startsOn, "Start date"),
        endsOn: optionalIsoDate(body.endsOn, "End date"),
      };
    case "delete_trip":
      return { action, orgId, id: uuid(body.id, "Trip") };
    case "create_hotel":
      return {
        action,
        orgId,
        tripId: uuid(body.tripId, "Trip"),
        name: requiredText(body.name, "Hotel name", 200),
        address: optionalText(body.address, 400),
        phone: optionalText(body.phone, 80),
        confirmationCode: optionalText(body.confirmationCode, 120),
        checkInAt: optionalIsoDateTime(body.checkInAt, "Check-in"),
        checkOutAt: optionalIsoDateTime(body.checkOutAt, "Check-out"),
        roomBlockNotes: optionalText(body.roomBlockNotes, 2000),
        notes: optionalText(body.notes, 2000),
      };
    case "delete_hotel":
      return { action, orgId, id: uuid(body.id, "Hotel") };
    case "upsert_room":
      return {
        action,
        orgId,
        hotelId: uuid(body.hotelId, "Hotel"),
        id: optionalUuid(body.id, "Room"),
        roomLabel: requiredText(body.roomLabel, "Room label", 80),
        occupantUserId: optionalUuid(body.occupantUserId, "Occupant"),
        occupantName: optionalText(body.occupantName, 120),
        notes: optionalText(body.notes, 500),
      };
    case "delete_room":
      return { action, orgId, id: uuid(body.id, "Room") };
    case "seed_checklist":
      return { action, orgId, tripId: optionalUuid(body.tripId, "Trip") };
    case "add_checklist_item":
      return {
        action,
        orgId,
        tripId: optionalUuid(body.tripId, "Trip"),
        audience: parseAudience(body.audience),
        label: requiredText(body.label, "Checklist item", 240),
      };
    case "delete_checklist_item":
      return { action, orgId, id: uuid(body.id, "Checklist item") };
    case "toggle_checklist":
      return { action, orgId, id: uuid(body.id, "Checklist item"), checked: Boolean(body.checked) };
    case "upsert_contact":
      return {
        action,
        orgId,
        id: optionalUuid(body.id, "Contact"),
        name: requiredText(body.name, "Contact name", 120),
        roleLabel: optionalText(body.roleLabel, 120),
        phone: optionalText(body.phone, 80),
        email: optionalText(body.email, 200),
        notes: optionalText(body.notes, 1000),
        isPrimary: Boolean(body.isPrimary),
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
      };
    case "delete_contact":
      return { action, orgId, id: uuid(body.id, "Contact") };
    case "upsert_on_duty":
      return {
        action,
        orgId,
        id: optionalUuid(body.id, "On-duty slot"),
        tripId: optionalUuid(body.tripId, "Trip"),
        mentorUserId: optionalUuid(body.mentorUserId, "Mentor"),
        mentorName: optionalText(body.mentorName, 120),
        phone: optionalText(body.phone, 80),
        startsAt: isoDateTime(body.startsAt, "Start"),
        endsAt: optionalIsoDateTime(body.endsAt, "End"),
        locationNote: optionalText(body.locationNote, 200),
        notes: optionalText(body.notes, 1000),
      };
    case "delete_on_duty":
      return { action, orgId, id: uuid(body.id, "On-duty slot") };
    case "upsert_travel_leg": {
      const kind = parseTravelKind(body.kind);
      const startsAt = isoDateTime(body.startsAt, "Start");
      const endsAt = optionalIsoDateTime(body.endsAt, "End");
      if (endsAt && endsAt < startsAt) throw new Error("End must be on or after the start");
      return {
        action,
        orgId,
        id: optionalUuid(body.id, "Travel leg"),
        tripId: uuid(body.tripId, "Trip"),
        kind,
        title: optionalText(body.title, 200) || defaultTravelLegTitle(kind),
        startsAt,
        endsAt,
        location: optionalText(body.location, 200),
        meetingPoint: optionalText(body.meetingPoint, 200),
        notes: optionalText(body.notes, 2000),
        subteamId: optionalUuid(body.subteamId, "Subteam"),
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
      };
    }
    case "delete_travel_leg":
      return { action, orgId, id: uuid(body.id, "Travel leg") };
    default:
      throw new Error("Unsupported logistics action");
  }
}
