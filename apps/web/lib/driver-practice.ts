// Practice Planner — sessions, goals, cycle-time reps, and optional links to
// attendance events / build tasks. Framework-free domain logic shared by the API
// route, the client UI, and unit tests. No server or React imports belong here.

/** Suggested cycle labels offered as a datalist; teams can type anything. */
export const SUGGESTED_ACTIONS = [
  "Score high",
  "Score mid",
  "Score low",
  "Intake",
  "Full cycle",
  "Climb",
  "Auto routine",
  "Defense evade",
] as const;

export type DriverCycle = {
  id: string;
  sessionId: string;
  action: string;
  seconds: number | null;
  success: boolean;
  note: string;
  repIndex: number;
  createdAt: string;
};

export type DriverSession = {
  id: string;
  title: string;
  eventKey: string | null;
  sessionDate: string; // YYYY-MM-DD
  driverUserId: string | null;
  driverName: string | null;
  location: string;
  goal: string;
  notes: string;
  attendanceEventId: string | null;
  attendanceEventTitle: string | null;
  buildTaskId: string | null;
  buildTaskTitle: string | null;
  createdAt: string;
  updatedAt: string;
  cycles: DriverCycle[];
};

export type DriverPracticeMember = { userId: string; name: string | null };

/** Lightweight pickers for optional Team links (empty when those modules are unavailable). */
export type LinkableAttendance = { id: string; title: string; startsAt: string; kind: string };
export type LinkableBuildTask = { id: string; title: string; status: string; subsystem: string };

export type DriverPracticeContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
  eventKey: string | null;
};

export type DriverPracticeView =
  | {
      status: "ready";
      context: DriverPracticeContext;
      sessions: DriverSession[];
      members: DriverPracticeMember[];
      attendanceEvents: LinkableAttendance[];
      buildTasks: LinkableBuildTask[];
    }
  | { status: "setup_required"; context: DriverPracticeContext; message: string };

// ---------------------------------------------------------------------------
// Derived metrics (pure, unit-tested).
// ---------------------------------------------------------------------------

const round2 = (value: number) => Math.round(value * 100) / 100;

export type DriverSessionSummary = {
  reps: number;
  timed: number;
  successes: number;
  successRate: number | null; // 0–100 integer, or null with no reps
  avgSeconds: number | null;
  bestSeconds: number | null; // fastest successful timed rep
};

export function sessionStats(cycles: DriverCycle[]): DriverSessionSummary {
  const reps = cycles.length;
  const timedValues = cycles.filter((cycle) => cycle.seconds != null).map((cycle) => cycle.seconds as number);
  const successes = cycles.filter((cycle) => cycle.success).length;
  const successfulTimed = cycles
    .filter((cycle) => cycle.success && cycle.seconds != null)
    .map((cycle) => cycle.seconds as number);
  return {
    reps,
    timed: timedValues.length,
    successes,
    successRate: reps ? Math.round((successes / reps) * 100) : null,
    avgSeconds: timedValues.length ? round2(timedValues.reduce((a, b) => a + b, 0) / timedValues.length) : null,
    bestSeconds: successfulTimed.length ? round2(Math.min(...successfulTimed)) : null,
  };
}

export type ActionStat = {
  action: string;
  reps: number;
  successRate: number | null;
  avgSeconds: number | null;
};

/** Per-action rollup within a set of cycles, most-practiced action first. */
export function actionBreakdown(cycles: DriverCycle[]): ActionStat[] {
  const byAction = new Map<string, DriverCycle[]>();
  for (const cycle of cycles) {
    const list = byAction.get(cycle.action) ?? [];
    list.push(cycle);
    byAction.set(cycle.action, list);
  }
  return [...byAction.entries()]
    .map(([action, list]) => {
      const stats = sessionStats(list);
      return { action, reps: stats.reps, successRate: stats.successRate, avgSeconds: stats.avgSeconds };
    })
    .sort((a, b) => b.reps - a.reps || a.action.localeCompare(b.action));
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

function optionalUuid(value: unknown, label: string) {
  if (value == null || value === "") return null;
  return uuid(value, label);
}

/** Optional date normalized to YYYY-MM-DD. */
function optionalDateOnly(value: unknown, label: string) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  const parsed = new Date(text.length <= 10 ? `${text}T00:00:00` : text);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is invalid`);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

/** Optional cycle time in seconds (0–3600, 2dp), or null. */
function optionalSeconds(value: unknown) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 3600) {
    throw new Error("Seconds must be between 0 and 3600");
  }
  return Math.round(number * 100) / 100;
}

const has = (body: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(body, key);

export type SessionPatch = {
  title?: string;
  eventKey?: string | null;
  sessionDate?: string | null;
  driverUserId?: string | null;
  driverName?: string | null;
  location?: string;
  goal?: string;
  notes?: string;
  attendanceEventId?: string | null;
  buildTaskId?: string | null;
};

export type CyclePatch = {
  action?: string;
  seconds?: number | null;
  success?: boolean;
  note?: string;
};

export type DriverPracticeAction =
  | {
      action: "create_session";
      orgId: string;
      title: string;
      eventKey: string | null;
      sessionDate: string | null;
      driverUserId: string | null;
      driverName: string | null;
      location: string;
      goal: string;
      notes: string;
      attendanceEventId: string | null;
      buildTaskId: string | null;
    }
  | { action: "update_session"; orgId: string; id: string; patch: SessionPatch }
  | { action: "delete_session"; orgId: string; id: string }
  | {
      action: "add_cycle";
      orgId: string;
      sessionId: string;
      cycleAction: string;
      seconds: number | null;
      success: boolean;
      note: string;
    }
  | { action: "update_cycle"; orgId: string; id: string; patch: CyclePatch }
  | { action: "delete_cycle"; orgId: string; id: string };

export function parseDriverPracticeAction(input: unknown): DriverPracticeAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid practice action");
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  const orgId = uuid(body.orgId, "Organization");

  switch (action) {
    case "create_session":
      return {
        action,
        orgId,
        title: requiredText(body.title, "Session title", 160),
        eventKey: optionalText(body.eventKey, 80),
        sessionDate: optionalDateOnly(body.sessionDate, "Session date"),
        driverUserId: optionalUuid(body.driverUserId, "Driver"),
        driverName: optionalText(body.driverName, 120),
        location: optionalText(body.location, 160) ?? "",
        goal: optionalText(body.goal, 500) ?? "",
        notes: optionalText(body.notes, 2_000) ?? "",
        attendanceEventId: optionalUuid(body.attendanceEventId, "Attendance event"),
        buildTaskId: optionalUuid(body.buildTaskId, "Build task"),
      };

    case "update_session": {
      const patch: SessionPatch = {};
      if (has(body, "title")) patch.title = requiredText(body.title, "Session title", 160);
      if (has(body, "eventKey")) patch.eventKey = optionalText(body.eventKey, 80);
      if (has(body, "sessionDate")) patch.sessionDate = optionalDateOnly(body.sessionDate, "Session date");
      if (has(body, "driverUserId")) patch.driverUserId = optionalUuid(body.driverUserId, "Driver");
      if (has(body, "driverName")) patch.driverName = optionalText(body.driverName, 120);
      if (has(body, "location")) patch.location = optionalText(body.location, 160) ?? "";
      if (has(body, "goal")) patch.goal = optionalText(body.goal, 500) ?? "";
      if (has(body, "notes")) patch.notes = optionalText(body.notes, 2_000) ?? "";
      if (has(body, "attendanceEventId")) patch.attendanceEventId = optionalUuid(body.attendanceEventId, "Attendance event");
      if (has(body, "buildTaskId")) patch.buildTaskId = optionalUuid(body.buildTaskId, "Build task");
      if (Object.keys(patch).length === 0) throw new Error("No changes provided");
      return { action, orgId, id: uuid(body.id, "Session"), patch };
    }

    case "delete_session":
      return { action, orgId, id: uuid(body.id, "Session") };

    case "add_cycle":
      return {
        action,
        orgId,
        sessionId: uuid(body.sessionId, "Session"),
        cycleAction: requiredText(body.cycleAction ?? body.cycle_action, "Cycle action", 80),
        seconds: optionalSeconds(body.seconds),
        success: body.success == null ? true : Boolean(body.success),
        note: optionalText(body.note, 500) ?? "",
      };

    case "update_cycle": {
      const patch: CyclePatch = {};
      if (has(body, "cycleAction")) patch.action = requiredText(body.cycleAction, "Cycle action", 80);
      if (has(body, "seconds")) patch.seconds = optionalSeconds(body.seconds);
      if (has(body, "success")) patch.success = Boolean(body.success);
      if (has(body, "note")) patch.note = optionalText(body.note, 500) ?? "";
      if (Object.keys(patch).length === 0) throw new Error("No changes provided");
      return { action, orgId, id: uuid(body.id, "Cycle"), patch };
    }

    case "delete_cycle":
      return { action, orgId, id: uuid(body.id, "Cycle") };

    default:
      throw new Error("Unsupported practice action");
  }
}
