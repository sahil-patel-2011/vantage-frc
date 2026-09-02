// Team Attendance — practice/meeting presence log. Framework-free domain logic
// shared by the API, client UI, and unit tests. Matches migration 0047 (+ 0099
// practice kind). No fabricated rates: empty orgs show empty states.

export const ATTENDANCE_KINDS = ["meeting", "build", "practice", "competition", "outreach", "other"] as const;
export type AttendanceKind = (typeof ATTENDANCE_KINDS)[number];

export const ATTENDANCE_KIND_LABELS: Record<AttendanceKind, string> = {
  meeting: "Meeting",
  build: "Build",
  practice: "Practice",
  competition: "Competition",
  outreach: "Outreach",
  other: "Other",
};

export const ATTENDANCE_ROLES = ["student", "mentor", "other"] as const;
export type AttendanceRole = (typeof ATTENDANCE_ROLES)[number];

export const ATTENDANCE_ROLE_LABELS: Record<AttendanceRole, string> = {
  student: "Student",
  mentor: "Mentor",
  other: "Other",
};

export type AttendanceEntry = {
  id: string;
  eventId: string;
  personName: string;
  /** Linked member account; null for a guest / free-text mark. */
  userId: string | null;
  role: AttendanceRole;
  hours: number | null;
  createdAt: string;
};

export type AttendanceEvent = {
  id: string;
  title: string;
  kind: AttendanceKind;
  occurredOn: string; // YYYY-MM-DD
  creditHours: number;
  seasonYear: number;
  createdByName: string | null;
  entries: AttendanceEntry[];
};

export type AttendanceContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
  userId: string | null;
  canManage: boolean;
};

export type AttendanceMember = { userId: string; name: string };

export type AttendanceView =
  | {
      status: "ready";
      context: AttendanceContext;
      events: AttendanceEvent[];
      seasonYear: number;
      seasons: number[];
      /** Org members for Soft-UI name suggestions — never fabricated. */
      members: AttendanceMember[];
    }
  | { status: "setup_required"; context: AttendanceContext; message: string };

export type PersonAttendanceRow = {
  personName: string;
  events: number;
  totalHours: number;
  studentEvents: number;
  mentorEvents: number;
};

export type AttendanceSummary = {
  eventCount: number;
  entryCount: number;
  uniquePeople: number;
  totalHours: number;
};

export function summarizeAttendance(events: AttendanceEvent[]): AttendanceSummary {
  const names = new Set<string>();
  let entryCount = 0;
  let totalHours = 0;
  for (const event of events) {
    for (const entry of event.entries) {
      entryCount += 1;
      names.add(entry.personName.trim().toLowerCase());
      const hours = entry.hours ?? event.creditHours;
      if (Number.isFinite(hours) && hours > 0) totalHours += hours;
    }
  }
  return {
    eventCount: events.length,
    entryCount,
    uniquePeople: names.size,
    totalHours: Math.round(totalHours * 100) / 100,
  };
}

/** Season rollup by person name (case-insensitive identity). */
export function personAttendanceBoard(events: AttendanceEvent[]): PersonAttendanceRow[] {
  const byName = new Map<string, PersonAttendanceRow>();
  for (const event of events) {
    for (const entry of event.entries) {
      const key = entry.personName.trim().toLowerCase();
      if (!key) continue;
      const row =
        byName.get(key) ??
        ({
          personName: entry.personName.trim(),
          events: 0,
          totalHours: 0,
          studentEvents: 0,
          mentorEvents: 0,
        } satisfies PersonAttendanceRow);
      row.events += 1;
      const hours = entry.hours ?? event.creditHours;
      if (Number.isFinite(hours) && hours > 0) row.totalHours = Math.round((row.totalHours + hours) * 100) / 100;
      if (entry.role === "student") row.studentEvents += 1;
      if (entry.role === "mentor") row.mentorEvents += 1;
      byName.set(key, row);
    }
  }
  return [...byName.values()].sort(
    (a, b) => b.events - a.events || b.totalHours - a.totalHours || a.personName.localeCompare(b.personName),
  );
}

function requiredText(value: unknown, label: string, max: number) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return text;
}

function optionalHours(value: unknown, label: string): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 24) throw new Error(`${label} must be between 0 and 24`);
  return Math.round(n * 100) / 100;
}

function uuid(value: unknown, label: string) {
  const text = requiredText(value, label, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function kindValue(value: unknown): AttendanceKind {
  if (value == null || value === "") return "meeting";
  const text = String(value).trim();
  if (!ATTENDANCE_KINDS.includes(text as AttendanceKind)) throw new Error("Invalid event kind");
  return text as AttendanceKind;
}

function roleValue(value: unknown): AttendanceRole {
  if (value == null || value === "") return "student";
  const text = String(value).trim();
  if (!ATTENDANCE_ROLES.includes(text as AttendanceRole)) throw new Error("Invalid attendee role");
  return text as AttendanceRole;
}

function dateValue(value: unknown, label: string) {
  const text = requiredText(value, label, 32);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} must be YYYY-MM-DD`);
  const parsed = new Date(`${text}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is invalid`);
  return text;
}

function seasonYearValue(value: unknown) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1992 || year > 3000) throw new Error("Season year is invalid");
  return year;
}

export function defaultSeasonYear(now = new Date()): number {
  // FRC season year is the championship year (spring). Fall kickoff rolls forward.
  return now.getUTCMonth() >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

export type AttendanceAction =
  | {
      action: "create_event";
      orgId: string;
      title: string;
      kind: AttendanceKind;
      occurredOn: string;
      creditHours: number;
      seasonYear: number;
    }
  | {
      action: "update_event";
      orgId: string;
      id: string;
      title: string;
      kind: AttendanceKind;
      occurredOn: string;
      creditHours: number;
      seasonYear: number;
    }
  | { action: "delete_event"; orgId: string; id: string }
  | {
      action: "add_entry";
      orgId: string;
      eventId: string;
      personName: string;
      /** Member to link the mark to; null keeps it a free-text guest mark. */
      userId: string | null;
      role: AttendanceRole;
      hours: number | null;
    }
  | { action: "delete_entry"; orgId: string; id: string };

export function parseAttendanceAction(input: unknown): AttendanceAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid attendance action");
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  const orgId = uuid(body.orgId, "Organization");

  switch (action) {
    case "create_event":
    case "update_event": {
      const credit = optionalHours(body.creditHours, "Credit hours") ?? 0;
      const base = {
        orgId,
        title: requiredText(body.title, "Title", 200),
        kind: kindValue(body.kind),
        occurredOn: dateValue(body.occurredOn, "Date"),
        creditHours: credit,
        seasonYear: seasonYearValue(body.seasonYear ?? defaultSeasonYear()),
      };
      if (action === "create_event") return { action, ...base };
      return { action, id: uuid(body.id, "Event"), ...base };
    }

    case "delete_event":
      return { action, orgId, id: uuid(body.id, "Event") };

    case "add_entry":
      return {
        action,
        orgId,
        eventId: uuid(body.eventId, "Event"),
        personName: requiredText(body.personName, "Name", 160),
        userId: body.userId == null || body.userId === "" ? null : uuid(body.userId, "Member"),
        role: roleValue(body.role),
        hours: optionalHours(body.hours, "Hours"),
      };

    case "delete_entry":
      return { action, orgId, id: uuid(body.id, "Entry") };

    default:
      throw new Error("Unsupported attendance action");
  }
}
