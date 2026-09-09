// Subteam calendars — org-scoped groups + filterable practice/build/deadline
// events. Framework-free domain logic for the API, client, and unit tests.
// No demo defaults: empty orgs show empty states until leads create subteams.

import type { TaskOnCalendar } from "./calendar/tasks-on-calendar";

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
  "#1457d9",
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

export const RSVP_RESPONSES = ["going", "maybe", "no"] as const;
export type RsvpResponse = (typeof RSVP_RESPONSES)[number];

export const RSVP_LABELS: Record<RsvpResponse, string> = {
  going: "I'm going",
  maybe: "Maybe",
  no: "Can't make it",
};

export type CalendarEventSource = "team" | "tba";

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
  /** Current user's RSVP, when the RSVP table is available. */
  myRsvp: RsvpResponse | null;
  rsvpGoing: number;
  rsvpMaybe: number;
  rsvpNo: number;
  /** TBA matches are read-only overlays from Neon `matches_ref` — never invented times. */
  source?: CalendarEventSource;
  bumper?: "red" | "blue";
};

export type CalendarViewMode = "agenda" | "week" | "month" | "day";

/** Timed week/day grid — Google Calendar-style hours, never invented events. */
export const CALENDAR_GRID_START_HOUR = 7;
export const CALENDAR_GRID_END_HOUR = 22;
export const CALENDAR_GRID_HOURS = Array.from(
  { length: CALENDAR_GRID_END_HOUR - CALENDAR_GRID_START_HOUR },
  (_, index) => CALENDAR_GRID_START_HOUR + index,
);

export type CalendarOverlayItem = {
  id: string;
  title: string;
  dueOn: string;
  href: string;
  source: "github";
};

export type GitHubCalendarOverlay = {
  connected: boolean;
  repo: string | null;
  items: CalendarOverlayItem[];
};

export type TimedCalendarBlock = {
  event: CalendarEvent;
  startMin: number;
  endMin: number;
  topPct: number;
  heightPct: number;
  col: number;
  cols: number;
};

export type CalendarGridCell = {
  day: string;
  inMonth: boolean;
  isToday: boolean;
  items: CalendarEvent[];
};

export type WorkflowLink = { href: string; label: string };

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

export const CALENDAR_FEED_SCOPES = ["personal", "org", "subteam"] as const;
export type CalendarFeedScope = (typeof CALENDAR_FEED_SCOPES)[number];

export type CalendarFeedInfo = {
  token: string | null;
  scope: CalendarFeedScope;
  subteamId: string | null;
};


export type TravelLegOnCalendar = {
  id: string;
  tripId: string;
  tripTitle: string;
  kind: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string;
  meetingPoint: string;
  notes: string;
  subteamId: string | null;
  subteamName: string | null;
  subteamColor: string | null;
  calendarEventId: string | null;
};

export type DutyOnCalendar = {
  id: string;
  title: string;
  kind: "scouting" | "pit" | "drive_team" | "outreach";
  startsAt: string;
  endsAt: string | null;
  subteamId: string | null;
  subteamName: string | null;
  subteamColor: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  calendarEventId: string | null;
  notes: string;
  createdByName: string | null;
  mine: boolean;
};

export type { TaskOnCalendar } from "./calendar/tasks-on-calendar";

export type SubteamCalendarView =
  | {
      status: "ready";
      context: SubteamCalendarContext;
      subteams: Subteam[];
      members: SubteamMemberLite[];
      events: CalendarEvent[];
      /** Duty roster slots (empty until assigned). */
      duties: DutyOnCalendar[];
      travelLegs: TravelLegOnCalendar[];
      mySubteamIds: string[];
      attendanceEvents: LinkableAttendance[];
      practiceSessions: LinkablePractice[];
      /** Personal subscribe token for the active scope (opaque; treat as a secret). */
      calendarFeed: CalendarFeedInfo;
      /** GitHub milestones with real due dates — empty until a repo is connected. */
      githubCalendar?: GitHubCalendarOverlay;
      /** This team's matches at the active event — empty until TBA cache has a real time. */
      tbaMatches?: CalendarEvent[];
      /** Open team tasks that have a due date — empty until someone sets one. */
      tasks?: TaskOnCalendar[];
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

/** Group filtered events by local calendar day (browser zone — matches week/month grids). */
export function groupEventsByDay(events: CalendarEvent[]): DayBucket[] {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of sortEvents(events)) {
    const day = localDayKey(new Date(event.startsAt));
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

/** Events for the signed-in member's subteams (plus whole-team rows). */
export function eventsForMySubteams(events: CalendarEvent[], mySubteamIds: string[]): CalendarEvent[] {
  if (mySubteamIds.length === 0) {
    return events.filter((event) => event.subteamId == null);
  }
  const mine = new Set(mySubteamIds);
  return events.filter((event) => event.subteamId == null || mine.has(event.subteamId));
}

function withOrgPath(path: string, orgId: string): string {
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}orgId=${encodeURIComponent(orgId)}`;
}

/**
 * Deep links from a calendar row into workflow surfaces.
 * Kind drives defaults; explicit practice / attendance / milestone links win when set.
 * Onboarding path (getting-started, wiki, logistics, kickoff) is additive.
 */
export function eventWorkflowLinks(event: CalendarEvent, orgId: string): WorkflowLink[] {
  const links: WorkflowLink[] = [];
  const push = (href: string, label: string) => {
    if (!links.some((link) => link.href === href)) links.push({ href, label });
  };

  if (event.driverSessionId || event.kind === "practice" || event.kind === "build") {
    push(withOrgPath("/practice", orgId), "Practice Planner");
  }
  if (event.kind === "event") {
    push(withOrgPath("/command", orgId), "Event Day Command");
    push(withOrgPath("/my-day", orgId), "My Day");
    push(withOrgPath("/scouting", orgId), "Scouting duty");
    push(withOrgPath("/logistics", orgId), "Event logistics");
  }
  if (event.kind === "deadline") {
    push(withOrgPath("/business", orgId), "Business deadlines");
    push(withOrgPath("/kickoff", orgId), "Kickoff summary");
  }
  if (event.attendanceEventId) {
    push(withOrgPath("/attendance", orgId), "Attendance roll call");
  }
  if (event.milestoneId) {
    push(withOrgPath("/calendar", orgId), "Season milestone");
  }
  if (event.kind === "meeting" || event.kind === "outreach") {
    push(withOrgPath("/team/calendar", orgId), "Team calendar");
  }
  if (event.kind === "outreach") {
    push(withOrgPath("/visit-invites", orgId), "Visit invites");
    push(withOrgPath("/logistics", orgId), "Event logistics");
  }
  if (event.kind === "practice" || event.kind === "build" || event.kind === "meeting") {
    push(withOrgPath("/team/knowledge", orgId), "Knowledge wiki");
  }
  push(withOrgPath("/team/getting-started", orgId), "Onboarding checklist");
  {
    const params = new URLSearchParams({
      orgId,
      linkType: "event",
      linkId: event.id,
      linkLabel: event.title,
    });
    push(`/messages?${params.toString()}`, "Discuss in Messages");
  }
  return links;
}

/** Local YYYY-MM-DD for a Date (browser / Node local zone). */
export function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseLocalDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** Sunday-start week (Soft-UI month grids match US FRC shop calendars). */
export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function eventsByLocalDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of sortEvents(events)) {
    const day = localDayKey(new Date(event.startsAt));
    const list = map.get(day) ?? [];
    list.push(event);
    map.set(day, list);
  }
  return map;
}

export function buildWeekCells(anchor: Date, events: CalendarEvent[], today: Date = new Date()): CalendarGridCell[] {
  const start = startOfWeek(anchor);
  const byDay = eventsByLocalDay(events);
  const todayKey = localDayKey(today);
  const cells: CalendarGridCell[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const day = localDayKey(date);
    cells.push({
      day,
      inMonth: true,
      isToday: day === todayKey,
      items: byDay.get(day) ?? [],
    });
  }
  return cells;
}

export function buildDayCells(anchor: Date, events: CalendarEvent[], today: Date = new Date()): CalendarGridCell[] {
  const day = localDayKey(anchor);
  const byDay = eventsByLocalDay(events);
  return [
    {
      day,
      inMonth: true,
      isToday: day === localDayKey(today),
      items: byDay.get(day) ?? [],
    },
  ];
}

export function buildMonthCells(anchor: Date, events: CalendarEvent[], today: Date = new Date()): CalendarGridCell[] {
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const byDay = eventsByLocalDay(events);
  const todayKey = localDayKey(today);
  const month = anchor.getMonth();
  const cells: CalendarGridCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const day = localDayKey(date);
    cells.push({
      day,
      inMonth: date.getMonth() === month,
      isToday: day === todayKey,
      items: byDay.get(day) ?? [],
    });
  }
  return cells;
}

export function shiftAnchor(anchor: Date, mode: CalendarViewMode, delta: number): Date {
  const next = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  if (mode === "month") {
    next.setMonth(next.getMonth() + delta);
    return next;
  }
  if (mode === "day") {
    next.setDate(next.getDate() + delta);
    return next;
  }
  next.setDate(next.getDate() + delta * 7);
  return next;
}

export function formatAnchorLabel(anchor: Date, mode: CalendarViewMode): string {
  if (mode === "month") {
    return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  if (mode === "day") {
    return anchor.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
  const start = startOfWeek(anchor);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const left = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const right = end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${left} – ${right}`;
}

export function formatHourLabel(hour: number): string {
  const date = new Date(2026, 0, 1, hour, 0, 0);
  return date.toLocaleTimeString(undefined, { hour: "numeric" });
}

export function isAllDayCalendarEvent(event: CalendarEvent): boolean {
  const start = new Date(event.startsAt);
  if (Number.isNaN(start.getTime())) return true;
  const end = event.endsAt ? new Date(event.endsAt) : null;
  if (start.getHours() === 0 && start.getMinutes() === 0 && !end) return true;
  if (end && !Number.isNaN(end.getTime()) && end.getTime() - start.getTime() >= 12 * 60 * 60 * 1000) {
    return true;
  }
  return false;
}

export function layoutTimedEventsForDay(events: CalendarEvent[]): TimedCalendarBlock[] {
  const span = (CALENDAR_GRID_END_HOUR - CALENDAR_GRID_START_HOUR) * 60;
  const origin = CALENDAR_GRID_START_HOUR * 60;
  const timed = events.filter((event) => !isAllDayCalendarEvent(event));
  const blocks: TimedCalendarBlock[] = timed
    .map((event) => {
      const start = new Date(event.startsAt);
      const end = event.endsAt ? new Date(event.endsAt) : new Date(start.getTime() + 60 * 60 * 1000);
      const startMin = Math.max(0, start.getHours() * 60 + start.getMinutes() - origin);
      const rawEnd = Number.isNaN(end.getTime())
        ? startMin + 60
        : end.getHours() * 60 + end.getMinutes() - origin;
      const endMin = Math.min(span, Math.max(startMin + 30, rawEnd));
      return {
        event,
        startMin,
        endMin,
        topPct: (startMin / span) * 100,
        heightPct: ((endMin - startMin) / span) * 100,
        col: 0,
        cols: 1,
      };
    })
    .sort((a, b) => a.startMin - b.startMin || a.event.title.localeCompare(b.event.title));

  const columnEnds: number[] = [];
  for (const block of blocks) {
    let col = columnEnds.findIndex((end) => end <= block.startMin);
    if (col < 0) {
      col = columnEnds.length;
      columnEnds.push(block.endMin);
    } else {
      columnEnds[col] = block.endMin;
    }
    block.col = col;
  }
  const cols = Math.max(1, columnEnds.length);
  for (const block of blocks) block.cols = cols;
  return blocks;
}

export function overlayItemsForDay(items: CalendarOverlayItem[] | undefined, day: string): CalendarOverlayItem[] {
  if (!items?.length) return [];
  return items.filter((item) => item.dueOn === day);
}

const TBA_MATCH_MS = 15 * 60 * 1000;
const TBA_RED = "#b91c1c";
const TBA_BLUE = "#1d4ed8";

const TBA_COMP_LABEL: Record<string, string> = {
  qm: "Qual",
  ef: "Eighth",
  qf: "QF",
  sf: "SF",
  f: "Final",
};

export type TbaMatchCalendarRow = {
  matchKey: string;
  compLevel: string;
  matchNumber: number;
  scheduledTime: string | null;
  redAlliance: unknown;
  blueAlliance: unknown;
  eventName: string | null;
};

/** Alliance JSON from `matches_ref` — TBA cache uses `teamKeys`. */
export function allianceTeamKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const rec = value as Record<string, unknown>;
  const raw = rec.teamKeys ?? rec.team_keys;
  if (!Array.isArray(raw)) return [];
  return raw.map((key) => String(key)).filter(Boolean);
}

export function tbaMatchTitle(compLevel: string, matchNumber: number, bumper: "red" | "blue"): string {
  const label = TBA_COMP_LABEL[compLevel] ?? compLevel.toUpperCase();
  return `${label} ${matchNumber} · ${bumper.toUpperCase()}`;
}

/**
 * Map cached TBA matches onto the team calendar.
 * Skips rows without a real start time and rows this team is not on — never invents DEMO matches.
 */
export function tbaMatchesToCalendarEvents(rows: TbaMatchCalendarRow[], teamKey: string): CalendarEvent[] {
  const key = teamKey.trim();
  if (!key) return [];
  const events: CalendarEvent[] = [];
  for (const row of rows) {
    const startsAt = row.scheduledTime?.trim() ?? "";
    if (!startsAt) continue;
    const start = new Date(startsAt);
    if (Number.isNaN(start.getTime())) continue;
    const red = allianceTeamKeys(row.redAlliance);
    const blue = allianceTeamKeys(row.blueAlliance);
    const bumper: "red" | "blue" | null = red.includes(key) ? "red" : blue.includes(key) ? "blue" : null;
    if (!bumper) continue;
    const matchKey = row.matchKey.trim();
    if (!matchKey) continue;
    events.push({
      id: `match-${matchKey}`,
      title: tbaMatchTitle(row.compLevel, row.matchNumber, bumper),
      kind: "event",
      startsAt,
      endsAt: new Date(start.getTime() + TBA_MATCH_MS).toISOString(),
      location: row.eventName?.trim() || "",
      notes: bumper === "red" ? "RED bumpers" : "BLUE bumpers",
      subteamId: null,
      subteamName: null,
      subteamColor: bumper === "red" ? TBA_RED : TBA_BLUE,
      attendanceEventId: null,
      attendanceEventTitle: null,
      milestoneId: null,
      driverSessionId: null,
      createdByName: null,
      myRsvp: null,
      rsvpGoing: 0,
      rsvpMaybe: 0,
      rsvpNo: 0,
      source: "tba",
      bumper,
    });
  }
  return events;
}

export function isReadonlyCalendarEvent(event: CalendarEvent): boolean {
  return event.source === "tba";
}

/** All-day ICS rows for GitHub milestones that already have a due date. */
export function githubItemsToIcsEvents(
  items: CalendarOverlayItem[] | undefined,
): Array<{
  id: string;
  title: string;
  kind: string;
  location: string;
  description: string;
  startsAt: string;
  endsAt: string | null;
  updatedAt: string;
  allDay?: boolean;
}> {
  if (!items?.length) return [];
  return items.map((item) => ({
    id: `github-${item.id}`,
    title: `GitHub · ${item.title}`,
    kind: "deadline",
    location: "",
    description: item.href,
    startsAt: item.dueOn,
    endsAt: item.dueOn,
    updatedAt: `${item.dueOn}T00:00:00.000Z`,
    allDay: true,
  }));
}

/** Default local datetime-local value for quick-add (next top-of-hour, or a picked day/hour). */
export function defaultQuickAddStartsAt(
  day?: string | null,
  now: Date = new Date(),
  hour?: number | null,
): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (day) {
    const picked = hour == null ? 16 : Math.max(0, Math.min(23, Math.floor(hour)));
    return `${day}T${pad(picked)}:00`;
  }
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

function feedScope(value: unknown): CalendarFeedScope {
  const text = requiredText(value ?? "personal", "Feed scope", 40);
  if (!(CALENDAR_FEED_SCOPES as readonly string[]).includes(text)) {
    throw new Error("Feed scope must be personal, org, or subteam");
  }
  return text as CalendarFeedScope;
}

function parseFeedAction(
  action: "ensure_calendar_feed" | "rotate_calendar_feed" | "disable_calendar_feed",
  orgId: string,
  body: Record<string, unknown>,
): SubteamCalendarAction {
  const scope = feedScope(body.scope);
  const subteamId = optionalUuid(body.subteamId, "Subteam");
  if (scope === "subteam" && !subteamId) throw new Error("Subteam is required for a subteam feed");
  if (scope !== "subteam" && subteamId) throw new Error("Subteam applies only to subteam feeds");
  return { action, orgId, scope, subteamId: scope === "subteam" ? subteamId : null };
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
  | { action: "delete_event"; orgId: string; id: string }
  | { action: "set_rsvp"; orgId: string; id: string; response: RsvpResponse | null; note: string }
  | {
      action: "ensure_calendar_feed";
      orgId: string;
      scope: CalendarFeedScope;
      subteamId: string | null;
    }
  | {
      action: "rotate_calendar_feed";
      orgId: string;
      scope: CalendarFeedScope;
      subteamId: string | null;
    }
  | {
      action: "disable_calendar_feed";
      orgId: string;
      scope: CalendarFeedScope;
      subteamId: string | null;
    };

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
        color: body.color == null || String(body.color).trim() === "" ? "#1457d9" : hexColor(body.color),
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

    case "set_rsvp": {
      const responseRaw = body.response;
      let response: RsvpResponse | null = null;
      if (responseRaw != null && String(responseRaw).trim() !== "") {
        const text = requiredText(responseRaw, "RSVP", 16);
        if (!(RSVP_RESPONSES as readonly string[]).includes(text)) {
          throw new Error("RSVP must be going, maybe, or no");
        }
        response = text as RsvpResponse;
      }
      return {
        action,
        orgId,
        id: uuid(body.id, "Event"),
        response,
        note: optionalText(body.note, 500),
      };
    }

    case "ensure_calendar_feed":
    case "rotate_calendar_feed":
    case "disable_calendar_feed":
      return parseFeedAction(action, orgId, body);

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
