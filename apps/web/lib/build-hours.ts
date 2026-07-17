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

function kindValue(value: unknown): HourKind {
  if (value == null || value === "") return "build";
  const text = String(value).trim();
  if (!HOUR_KINDS.includes(text as HourKind)) throw new Error("Invalid session kind");
  return text as HourKind;
}

const MAX_SESSION_HOURS = 24;

/** Validate a manual in/out pair: out after in, and no marathon > 24h. */
export function validateManualRange(clockIn: string, clockOut: string) {
  const start = new Date(clockIn).getTime();
  const end = new Date(clockOut).getTime();
  if (end <= start) throw new Error("Clock-out must be after clock-in");
  if (end - start > MAX_SESSION_HOURS * 3_600_000) {
    throw new Error(`A single session cannot exceed ${MAX_SESSION_HOURS} hours`);
  }
}

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
      };
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
