// Subteam calendars — org-scoped groups + filterable practice/build/deadline
// events. Framework-free domain logic for the API, client, and unit tests.
// No demo defaults: empty orgs show empty states until leads create subteams.

export const SUBTEAM_EVENT_KINDS = [
  "practice",
  "build",
  "deadline",
  "event",
  "meeting",
  "outreach",
  "other",
] as const;
export type SubteamEventKind = (typeof SUBTEAM_EVENT_KINDS)[number];

export const SUBTEAM_EVENT_KIND_LABELS: Record<SubteamEventKind, string> = {
  practice: "Practice",
  build: "Build session",
  deadline: "Deadline",
  event: "Event",
  meeting: "Meeting",
  outreach: "Outreach",
  other: "Other",
};

/** Soft palette suggestions for the create-subteam color picker (not auto-seeded). */
export const SUBTEAM_COLOR_SUGGESTIONS = [
  "#1f4fd6",
  "#0f766e",
  "#2d6a4f",
  "#b08900",
  "#9a3412",
  "#334155",
  "#0369a1",
  "#7c2d12",
] as const;

export type Subteam = {
  id: string;
  name: string;
  color: string;
  description: string;
  sortOrder: number;
  memberCount: number;
};

export type SubteamMemberLite = {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  subteamIds: string[];
};

export type CalendarEvent = {
  id: string;
  title: string;
  kind: SubteamEventKind;
  startsAt: string;
  endsAt: string | null;
  location: string;
  notes: string;
  subteamId: string | null;
  subteamName: string | null;
  subteamColor: string | null;
  attendanceEventId: string | null;
  attendanceEventTitle: string | null;
  milestoneId: string | null;
  driverSessionId: string | null;
  createdByName: string | null;
};

export type LinkableAttendance = {
  id: string;
  title: string;
  occurredOn: string;
  kind: string;
};

export type LinkablePractice = {
  id: string;
  title: string;
  sessionDate: string;
};

export type SubteamCalendarContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
  userId: string | null;
  canManage: boolean;
};

export type SubteamCalendarView =
  | {
      status: "ready";
      context: SubteamCalendarContext;
      subteams: Subteam[];
      members: SubteamMemberLite[];
      events: CalendarEvent[];
      mySubteamIds: string[];
      attendanceEvents: LinkableAttendance[];
      practiceSessions: LinkablePractice[];
    }
  | { status: "setup_required"; context: SubteamCalendarContext; message: string };

/** Filter events for the combined team view or a single subteam (+ whole-team rows). */
export function filterEventsBySubteam(
  events: CalendarEvent[],
  subteamId: string | null,
): CalendarEvent[] {
  if (!subteamId) return events;
  return events.filter((event) => event.subteamId == null || event.subteamId === subteamId);
}

/** Sort ascending by start time, then title. */
export function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title),
  );
}

export type DayBucket = { day: string; label: string; items: CalendarEvent[] };

/** Group filtered events by local calendar day (YYYY-MM-DD of startsAt). */
export function groupEventsByDay(events: CalendarEvent[]): DayBucket[] {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of sortEvents(events)) {
    const day = event.startsAt.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(event);
    byDay.set(day, list);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, items]) => ({
      day,
      label: formatDayLabel(day),
      items,
    }));
}

function formatDayLabel(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Upcoming (not-yet-ended) events, soonest first. */
export function upcomingEvents(events: CalendarEvent[], now: Date = new Date(), limit = 5): CalendarEvent[] {
  const iso = now.toISOString();
  return sortEvents(events)
    .filter((event) => (event.endsAt ?? event.startsAt) >= iso)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Action validation
// ---------------------------------------------------------------------------

function requiredText(value: unknown, label: string, max: number) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return text;
}

function optionalText(value: unknown, max: number) {
  if (value == null) return "";
  const text = String(value).trim();
  if (text.length > max) throw new Error(`Value must be ${max} characters or fewer`);
  return text;
}

function uuid(value: unknown, label: string) {
  const text = requiredText(value, label, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function optionalUuid(value: unknown, label: string): string | null {
  if (value == null || String(value).trim() === "") return null;
  return uuid(value, label);
}

function hexColor(value: unknown): string {
  const text = requiredText(value, "Color", 16);
  if (!/^#[0-9A-Fa-f]{6}$/.test(text)) throw new Error("Color must be a #RRGGBB hex value");
  return text.toLowerCase();
}

function eventKind(value: unknown): SubteamEventKind {
  const text = requiredText(value, "Kind", 40);
  if (!(SUBTEAM_EVENT_KINDS as readonly string[]).includes(text)) throw new Error("Kind is invalid");
  return text as SubteamEventKind;
}

/** Accept ISO datetime or datetime-local; normalize to ISO string. */
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

function isoDate(value: unknown, label: string): string {
  const text = requiredText(value, label, 40);
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (!match) throw new Error(`${label} must be a valid date (YYYY-MM-DD)`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`${label} must be a valid date (YYYY-MM-DD)`);
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function uuidList(value: unknown, label: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be a list`);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const id = uuid(item, label);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export type EventPatch = {
  title?: string;
  kind?: SubteamEventKind;
  startsAt?: string;
  endsAt?: string | null;
  location?: string;
  notes?: string;
  subteamId?: string | null;
  attendanceEventId?: string | null;
  driverSessionId?: string | null;
  milestoneId?: string | null;
};

export type SubteamCalendarAction =
  | { action: "create_subteam"; orgId: string; name: string; color: string; description: string }
  | { action: "update_subteam"; orgId: string; id: string; name?: string; color?: string; description?: string }
  | { action: "delete_subteam"; orgId: string; id: string }
  | { action: "set_member_subteams"; orgId: string; userId: string; subteamIds: string[] }
  | {
      action: "create_event";
      orgId: string;
      title: string;
      kind: SubteamEventKind;
      startsAt: string;
      endsAt: string | null;
      location: string;
      notes: string;
      subteamId: string | null;
      attendanceEventId: string | null;
      driverSessionId: string | null;
      milestoneId: string | null;
      /** When true and no attendanceEventId, create a linked attendance roll-call row. */
      createAttendance: boolean;
      attendanceCreditHours: number;
    }
  | { action: "update_event"; orgId: string; id: string; patch: EventPatch }
  | { action: "delete_event"; orgId: string; id: string };

export function parseSubteamCalendarAction(input: unknown): SubteamCalendarAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid calendar action");
  }
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  const orgId = uuid(body.orgId, "Organization");

  switch (action) {
    case "create_subteam":
      return {
        action,
        orgId,
        name: requiredText(body.name, "Subteam name", 80),
        color: body.color == null || String(body.color).trim() === "" ? "#1f4fd6" : hexColor(body.color),
        description: optionalText(body.description, 500),
      };

    case "update_subteam": {
      const id = uuid(body.id, "Subteam");
      const patch: { name?: string; color?: string; description?: string } = {};
      if (Object.prototype.hasOwnProperty.call(body, "name")) {
        patch.name = requiredText(body.name, "Subteam name", 80);
      }
      if (Object.prototype.hasOwnProperty.call(body, "color")) {
        patch.color = hexColor(body.color);
      }
      if (Object.prototype.hasOwnProperty.call(body, "description")) {
        patch.description = optionalText(body.description, 500);
      }
      if (!patch.name && !patch.color && patch.description === undefined) {
        throw new Error("No changes provided");
      }
      return { action, orgId, id, ...patch };
    }

    case "delete_subteam":
      return { action, orgId, id: uuid(body.id, "Subteam") };

    case "set_member_subteams":
      return {
        action,
        orgId,
        userId: uuid(body.userId, "Member"),
        subteamIds: uuidList(body.subteamIds, "Subteam"),
      };

    case "create_event": {
      const startsAt = isoDateTime(body.startsAt, "Start");
      const endsAt = optionalIsoDateTime(body.endsAt, "End");
      if (endsAt && endsAt < startsAt) throw new Error("End must be on or after the start");
      const creditRaw = body.attendanceCreditHours;
      const attendanceCreditHours =
        creditRaw == null || creditRaw === ""
          ? 2
          : Number(creditRaw);
      if (!Number.isFinite(attendanceCreditHours) || attendanceCreditHours < 0 || attendanceCreditHours > 24) {
        throw new Error("Attendance credit hours must be between 0 and 24");
      }
      return {
        action,
        orgId,
        title: requiredText(body.title, "Title", 200),
        kind: eventKind(body.kind ?? "practice"),
        startsAt,
        endsAt,
        location: optionalText(body.location, 200),
        notes: optionalText(body.notes, 2000),
        subteamId: optionalUuid(body.subteamId, "Subteam"),
        attendanceEventId: optionalUuid(body.attendanceEventId, "Attendance event"),
        driverSessionId: optionalUuid(body.driverSessionId, "Practice session"),
        milestoneId: optionalUuid(body.milestoneId, "Milestone"),
        createAttendance: Boolean(body.createAttendance),
        attendanceCreditHours,
      };
    }

    case "update_event": {
      const id = uuid(body.id, "Event");
      const source =
        body.patch && typeof body.patch === "object" && !Array.isArray(body.patch)
          ? (body.patch as Record<string, unknown>)
          : {};
      const patch: EventPatch = {};
      if (Object.prototype.hasOwnProperty.call(source, "title")) {
        patch.title = requiredText(source.title, "Title", 200);
      }
      if (Object.prototype.hasOwnProperty.call(source, "kind")) {
        patch.kind = eventKind(source.kind);
      }
      if (Object.prototype.hasOwnProperty.call(source, "startsAt")) {
        patch.startsAt = isoDateTime(source.startsAt, "Start");
      }
      if (Object.prototype.hasOwnProperty.call(source, "endsAt")) {
        patch.endsAt = optionalIsoDateTime(source.endsAt, "End");
      }
      if (Object.prototype.hasOwnProperty.call(source, "location")) {
        patch.location = optionalText(source.location, 200);
      }
      if (Object.prototype.hasOwnProperty.call(source, "notes")) {
        patch.notes = optionalText(source.notes, 2000);
      }
      if (Object.prototype.hasOwnProperty.call(source, "subteamId")) {
        patch.subteamId = optionalUuid(source.subteamId, "Subteam");
      }
      if (Object.prototype.hasOwnProperty.call(source, "attendanceEventId")) {
        patch.attendanceEventId = optionalUuid(source.attendanceEventId, "Attendance event");
      }
      if (Object.prototype.hasOwnProperty.call(source, "driverSessionId")) {
        patch.driverSessionId = optionalUuid(source.driverSessionId, "Practice session");
      }
      if (Object.prototype.hasOwnProperty.call(source, "milestoneId")) {
        patch.milestoneId = optionalUuid(source.milestoneId, "Milestone");
      }
      if (Object.keys(patch).length === 0) throw new Error("No changes provided");
      if (patch.startsAt && patch.endsAt && patch.endsAt < patch.startsAt) {
        throw new Error("End must be on or after the start");
      }
      return { action, orgId, id, patch };
    }

    case "delete_event":
      return { action, orgId, id: uuid(body.id, "Event") };

    default:
      throw new Error("Unsupported calendar action");
  }
}

/** Date part of an event start for attendance.occurred_on. */
export function attendanceDateFromStart(startsAtIso: string): string {
  return isoDate(startsAtIso.slice(0, 10), "Attendance date");
}

export function defaultSeasonYear(now: Date = new Date()): number {
  // FRC seasons are named by the year of the kickoff/competition spring.
  const month = now.getUTCMonth(); // 0-indexed
  const year = now.getUTCFullYear();
  return month >= 8 ? year + 1 : year;
}
