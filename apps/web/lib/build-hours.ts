// Build Hours (Cheesy Hours-style shop-time tracking) — framework-free domain
// logic shared by the API route, the client UI, and unit tests. No server or
// React imports belong here. Distinct from lib/attendance/* (meeting attendance).

export const HOUR_KINDS = ["build", "meeting", "outreach", "competition", "other"] as const;
export type HourKind = (typeof HOUR_KINDS)[number];

export const HOUR_KIND_LABELS: Record<HourKind, string> = {
  build: "Build",
  meeting: "Meeting",
  outreach: "Outreach",
  competition: "Competition",
  other: "Other",
};

export type HourLog = {
  id: string;
  userId: string;
  userName: string | null;
  kind: HourKind;
  clockIn: string;
  clockOut: string | null;
  note: string;
  closedByName: string | null;
  /**
   * How the entry was made (0723): "manual" was typed in after the fact, "clock" was clocked.
   * Absent before 0723 is applied, and on entries from before it, which read as clocked.
   */
  entrySource?: "clock" | "manual" | null;
  /** A mentor's correction of the times, with why (0723). */
  correctionNote?: string | null;
  correctedByName?: string | null;
  correctedAt?: string | null;
};

export type HourPolicy = {
  seasonGoalHours: number;
  seasonStart: string | null; // YYYY-MM-DD
};

export type HourMember = { userId: string; name: string | null; role: string };

export type BuildHoursContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
  userId: string | null;
};

export type BuildHoursView =
  | {
      status: "ready";
      context: BuildHoursContext;
      records: HourLog[];
      policy: HourPolicy;
      members: HourMember[];
    }
  | { status: "setup_required"; context: BuildHoursContext; message: string };

// ---------------------------------------------------------------------------
// Derived metrics (pure, unit-tested).
// ---------------------------------------------------------------------------

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Hours between clock-in and clock-out (or `now` for an open session). */
export function recordHours(record: Pick<HourLog, "clockIn" | "clockOut">, now = Date.now()): number {
  const start = new Date(record.clockIn).getTime();
  const end = record.clockOut ? new Date(record.clockOut).getTime() : now;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return round2((end - start) / 3_600_000);
}

export type MemberHoursRow = {
  userId: string;
  name: string | null;
  totalHours: number;
  sessions: number;
  openRecordId: string | null;
  lastSeen: string | null; // most recent clock-in
  goalPercent: number | null; // vs season goal, capped at 100; null when no goal
};

/**
 * Roll up logs into a per-member leaderboard (highest hours first). Open
 * sessions count their elapsed time so the board is live during a meeting.
 */
export function memberLeaderboard(
  records: HourLog[],
  members: HourMember[],
  goalHours: number,
  now = Date.now(),
): MemberHoursRow[] {
  const byUser = new Map<string, HourLog[]>();
  for (const record of records) {
    const list = byUser.get(record.userId) ?? [];
    list.push(record);
    byUser.set(record.userId, list);
  }
  const nameById = new Map(members.map((member) => [member.userId, member.name]));
  const userIds = new Set([...byUser.keys(), ...members.map((member) => member.userId)]);

  return [...userIds]
    .map((userId) => {
      const list = byUser.get(userId) ?? [];
      const totalHours = round2(list.reduce((sum, record) => sum + recordHours(record, now), 0));
      const open = list.find((record) => record.clockOut == null) ?? null;
      const lastSeen = list.length
        ? list.reduce((latest, record) => (record.clockIn > latest ? record.clockIn : latest), list[0]!.clockIn)
        : null;
      return {
        userId,
        name: nameById.get(userId) ?? list[0]?.userName ?? null,
        totalHours,
        sessions: list.length,
        openRecordId: open?.id ?? null,
        lastSeen,
        goalPercent: goalHours > 0 ? Math.min(100, Math.round((totalHours / goalHours) * 100)) : null,
      };
    })
    .sort((a, b) => b.totalHours - a.totalHours || (a.name ?? "").localeCompare(b.name ?? ""));
}

export type BuildHoursSummary = {
  hereNow: number;
  totalHours: number;
  activeMembers: number; // members with at least one session
  avgHours: number | null;
};

export function summarizeHours(records: HourLog[], now = Date.now()): BuildHoursSummary {
  const open = records.filter((record) => record.clockOut == null);
  const users = new Set(records.map((record) => record.userId));
  const totalHours = round2(records.reduce((sum, record) => sum + recordHours(record, now), 0));
  return {
    hereNow: open.length,
    totalHours,
    activeMembers: users.size,
    avgHours: users.size ? round2(totalHours / users.size) : null,
  };
}

// ---------------------------------------------------------------------------
// Action validation (mirrors the inventory/practice parse pattern).
// ---------------------------------------------------------------------------

function requiredText(value: unknown, label: string, max: number) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return text;
}

function optionalText(value: unknown, max: number) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
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

function timestamp(value: unknown, label: string) {
  const parsed = new Date(String(value ?? ""));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is invalid`);
  return parsed.toISOString();
}

/** A real IANA zone name, or undefined (the server then writes times in UTC). */
function timeZoneValue(value: unknown): string | undefined {
  if (typeof value !== "string" || !value || value.length > 64) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return undefined;
  }
}

function kindValue(value: unknown): HourKind {
  if (value == null || value === "") return "build";
  const text = String(value).trim();
  if (!HOUR_KINDS.includes(text as HourKind)) throw new Error("Invalid session kind");
  return text as HourKind;
}

const MAX_SESSION_HOURS = 24;
/** Shorter than this is a slip of the finger, not a session (QA logged a 30-second one). */
export const MIN_SESSION_MINUTES = 5;
/** Clocks on a phone and a server disagree by a little; a few minutes ahead is still "now". */
const FUTURE_SLACK_MS = 5 * 60_000;

/**
 * Validate a typed-in session: it has ended (nobody adds hours they have not worked yet), runs
 * at least MIN_SESSION_MINUTES and at most a day, and ends after it starts. Each refusal says
 * what to change.
 */
export function validateManualRange(clockIn: string, clockOut: string, now: number = Date.now()) {
  const start = new Date(clockIn).getTime();
  const end = new Date(clockOut).getTime();
  if (end <= start) throw new Error("The end time must be after the start time.");
  if (start > now + FUTURE_SLACK_MS || end > now + FUTURE_SLACK_MS) {
    throw new Error("Those hours haven't happened yet. Add hours after the session, or clock in now.");
  }
  if (end - start < MIN_SESSION_MINUTES * 60_000) {
    throw new Error(`A session needs to be at least ${MIN_SESSION_MINUTES} minutes long.`);
  }
  if (end - start > MAX_SESSION_HOURS * 3_600_000) {
    throw new Error(`A single session can't be longer than ${MAX_SESSION_HOURS} hours. Split it into separate days.`);
  }
}

/** A record that overlaps [clockIn, clockOut) for the same member; open sessions run until now. */
export function overlappingRecord<T extends Pick<HourLog, "id" | "clockIn" | "clockOut">>(
  records: readonly T[],
  range: { clockIn: string; clockOut: string; excludeId?: string | null },
  now: number = Date.now(),
): T | null {
  const start = new Date(range.clockIn).getTime();
  const end = new Date(range.clockOut).getTime();
  for (const record of records) {
    if (record.id === range.excludeId) continue;
    const otherStart = new Date(record.clockIn).getTime();
    const otherEnd = record.clockOut ? new Date(record.clockOut).getTime() : now;
    if (otherStart < end && otherEnd > start) return record;
  }
  return null;
}

/** "Oct 10, 10:00 AM – 2:00 PM": the session a refusal or a correction note is about. */
export function describeSessionRange(clockIn: string, clockOut: string | null, timeZone?: string): string {
  const start = new Date(clockIn);
  const day: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric", timeZone };
  const time: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", timeZone };
  const startText = `${start.toLocaleDateString("en-US", day)}, ${start.toLocaleTimeString("en-US", time)}`;
  if (!clockOut) return `${startText} – still clocked in`;
  const end = new Date(clockOut);
  const sameDay = start.toLocaleDateString("en-US", day) === end.toLocaleDateString("en-US", day);
  return `${startText} – ${sameDay ? "" : `${end.toLocaleDateString("en-US", day)}, `}${end.toLocaleTimeString("en-US", time)}`;
}

/** The sentence for a typed-in session that lands on top of another one. */
export function overlapMessage(other: Pick<HourLog, "clockIn" | "clockOut">, timeZone?: string): string {
  return `Those hours overlap an entry already logged (${describeSessionRange(other.clockIn, other.clockOut, timeZone)}). Change the times, or ask a mentor to correct the other entry.`;
}

/** A mentor's correction always says why; shorter notes are refused. */
export const MIN_CORRECTION_NOTE_LENGTH = 3;

export type BuildHoursAction =
  | { action: "clock_in"; orgId: string; kind: HourKind; note: string; userId: string | null }
  | { action: "clock_out"; orgId: string; recordId: string | null; note: string | null }
  | {
      action: "add_manual";
      orgId: string;
      userId: string | null; // admins may log for someone else; null = self
      kind: HourKind;
      clockIn: string;
      clockOut: string;
      note: string;
      /** The sender's IANA time zone, so a refusal names times the way they typed them. */
      timeZone: string | undefined;
    }
  | {
      /** An owner/admin fixes a session's times (a forgotten clock-out), with a note saying why. */
      action: "correct_record";
      orgId: string;
      id: string;
      clockIn: string;
      clockOut: string;
      note: string;
      timeZone: string | undefined;
    }
  | { action: "delete_record"; orgId: string; id: string }
  | { action: "close_all_open"; orgId: string }
  | { action: "set_policy"; orgId: string; seasonGoalHours: number; seasonStart: string | null };

export function parseBuildHoursAction(input: unknown): BuildHoursAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid hours action");
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  const orgId = uuid(body.orgId, "Organization");

  switch (action) {
    case "clock_in":
      return {
        action,
        orgId,
        kind: kindValue(body.kind),
        note: optionalText(body.note, 300) ?? "",
        // Kiosk mode: an owner/admin device may clock in another member.
        userId: body.userId == null || body.userId === "" ? null : uuid(body.userId, "Member"),
      };

    case "clock_out":
      return {
        action,
        orgId,
        recordId: body.recordId == null || body.recordId === "" ? null : uuid(body.recordId, "Record"),
        note: optionalText(body.note, 300),
      };

    case "add_manual": {
      const clockIn = timestamp(body.clockIn, "Clock-in time");
      const clockOut = timestamp(body.clockOut, "Clock-out time");
      validateManualRange(clockIn, clockOut);
      return {
        action,
        orgId,
        userId: body.userId == null || body.userId === "" ? null : uuid(body.userId, "Member"),
        kind: kindValue(body.kind),
        clockIn,
        clockOut,
        note: optionalText(body.note, 300) ?? "",
        timeZone: timeZoneValue(body.timeZone),
      };
    }

    case "correct_record": {
      const clockIn = timestamp(body.clockIn, "Start time");
      const clockOut = timestamp(body.clockOut, "End time");
      validateManualRange(clockIn, clockOut);
      const note = optionalText(body.note, 300) ?? "";
      if (note.length < MIN_CORRECTION_NOTE_LENGTH) {
        throw new Error("Say why you are changing these times, like \"Forgot to clock out at 6 PM\".");
      }
      return { action, orgId, id: uuid(body.id, "Record"), clockIn, clockOut, note, timeZone: timeZoneValue(body.timeZone) };
    }

    case "delete_record":
      return { action, orgId, id: uuid(body.id, "Record") };

    case "close_all_open":
      return { action, orgId };

    case "set_policy": {
      const goal = Number(body.seasonGoalHours);
      if (!Number.isFinite(goal) || goal < 0 || goal > 10_000) {
        throw new Error("Season goal must be between 0 and 10000 hours");
      }
      let seasonStart: string | null = null;
      if (body.seasonStart != null && body.seasonStart !== "") {
        const parsed = new Date(String(body.seasonStart).length <= 10 ? `${body.seasonStart}T00:00:00` : String(body.seasonStart));
        if (Number.isNaN(parsed.getTime())) throw new Error("Season start is invalid");
        const pad = (n: number) => String(n).padStart(2, "0");
        seasonStart = `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
      }
      return { action, orgId, seasonGoalHours: Math.round(goal * 100) / 100, seasonStart };
    }

    default:
      throw new Error("Unsupported hours action");
  }
}
