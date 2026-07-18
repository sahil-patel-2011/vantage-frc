// Season Calendar & Milestones — framework-free domain logic shared by the API
// route, the client UI, and unit tests. No server or React imports belong here.

export const MILESTONE_KINDS = [
  "kickoff",
  "design",
  "build",
  "practice",
  "event",
  "deadline",
  "meeting",
  "outreach",
  "other",
] as const;

export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export const KIND_LABELS: Record<MilestoneKind, string> = {
  kickoff: "Kickoff",
  design: "Design",
  build: "Build",
  practice: "Practice",
  event: "Event",
  deadline: "Deadline",
  meeting: "Meeting",
  outreach: "Outreach",
  other: "Other",
};

export type Milestone = {
  id: string;
  title: string;
  kind: MilestoneKind;
  startsOn: string;
  endsOn: string | null;
  notes: string;
  /** Remote-join link (Zoom / Google Meet / Teams / any https URL), if this entry is joinable. */
  meetingUrl: string | null;
  done: boolean;
  doneAt: string | null;
  doneByName: string | null;
  createdByName: string | null;
};

/** Human label for a meeting link's provider, for Join buttons. */
export function meetingProvider(url: string | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "zoom.us" || host.endsWith(".zoom.us")) return "Zoom";
    if (host === "meet.google.com") return "Google Meet";
    if (host === "teams.microsoft.com" || host === "teams.live.com") return "Teams";
    if (host === "discord.gg" || host === "discord.com" || host.endsWith(".discord.com")) return "Discord";
    return "Meeting";
  } catch {
    return null;
  }
}

/** Validate an optional https meeting URL (max 500 chars); returns normalized string or null. */
export function optionalMeetingUrl(value: unknown): string | null {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (text.length > 500) throw new Error("Meeting link must be 500 characters or fewer");
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("Meeting link must be a full https:// URL");
  }
  if (parsed.protocol !== "https:") throw new Error("Meeting link must use https");
  if (!parsed.hostname.includes(".")) throw new Error("Meeting link must be a full https:// URL");
  return parsed.toString();
}

export type CalendarContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
};

export type CalendarView =
  | { status: "ready"; context: CalendarContext; milestones: Milestone[] }
  | { status: "setup_required"; context: CalendarContext; message: string };

/** Standard FRC build-season arc, offsets in days relative to Kickoff (day 0). */
export const SEASON_TEMPLATE: Array<{ offsetDays: number; title: string; kind: MilestoneKind }> = [
  { offsetDays: 0, title: "Kickoff & game reveal", kind: "kickoff" },
  { offsetDays: 1, title: "Game analysis & scoring priorities", kind: "design" },
  { offsetDays: 7, title: "Architecture & priority list locked", kind: "design" },
  { offsetDays: 14, title: "Design freeze — CAD complete", kind: "design" },
  { offsetDays: 21, title: "Drivetrain rolling", kind: "build" },
  { offsetDays: 28, title: "All mechanisms prototyped", kind: "build" },
  { offsetDays: 35, title: "Full robot integrated", kind: "build" },
  { offsetDays: 42, title: "Robot fully functional", kind: "build" },
  { offsetDays: 45, title: "Drive practice begins", kind: "practice" },
  { offsetDays: 52, title: "Software & auto feature freeze", kind: "deadline" },
];

// ---------------------------------------------------------------------------
// Date helpers & derived views (pure, unit-tested).
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function formatDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Add whole days to a YYYY-MM-DD string, returning a YYYY-MM-DD string. */
function addDays(dateISO: string, days: number): string {
  const date = new Date(`${dateISO}T00:00:00`);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

/** Date every SEASON_TEMPLATE entry relative to the given kickoff date. */
export function seedFromKickoff(kickoffDate: string): Array<{ title: string; kind: MilestoneKind; startsOn: string }> {
  return SEASON_TEMPLATE.map((entry) => ({
    title: entry.title,
    kind: entry.kind,
    startsOn: addDays(kickoffDate, entry.offsetDays),
  }));
}

/** Whole days until the given date: 0 today, positive future, negative past. */
export function daysUntil(dateISO: string, now: Date = new Date()): number {
  const target = new Date(`${dateISO}T00:00:00`);
  const days = Math.ceil((target.getTime() - now.getTime()) / DAY_MS);
  return days === 0 ? 0 : days; // normalize Math.ceil's negative zero
}

/** First not-done milestone starting today or later, else null. */
export function nextUpcoming(milestones: Milestone[], now: Date = new Date()): Milestone | null {
  const upcoming = milestones
    .filter((milestone) => !milestone.done && daysUntil(milestone.startsOn, now) >= 0)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  return upcoming[0] ?? null;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthLabel(month: string): string {
  const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1];
  return name ? `${name} ${month.slice(0, 4)}` : month;
}

/** Group milestones by start month, both months and items sorted ascending. */
export function groupByMonth(milestones: Milestone[]): Array<{ month: string; label: string; items: Milestone[] }> {
  const byMonth = new Map<string, Milestone[]>();
  for (const milestone of milestones) {
    const month = milestone.startsOn.slice(0, 7);
    const list = byMonth.get(month) ?? [];
    list.push(milestone);
    byMonth.set(month, list);
  }
  return [...byMonth.entries()]
    .map(([month, items]) => ({
      month,
      label: monthLabel(month),
      items: [...items].sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.title.localeCompare(b.title)),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export type SeasonProgress = { total: number; done: number; percent: number };

export function seasonProgress(milestones: Milestone[]): SeasonProgress {
  const total = milestones.length;
  const done = milestones.filter((milestone) => milestone.done).length;
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
}

// ---------------------------------------------------------------------------
// Action validation (mirrors the other module parse patterns).
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

/** Validate a calendar date and normalize it to YYYY-MM-DD. */
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

function milestoneKind(value: unknown): MilestoneKind {
  const text = requiredText(value, "Kind", 40);
  if (!(MILESTONE_KINDS as readonly string[]).includes(text)) throw new Error("Kind is invalid");
  return text as MilestoneKind;
}

function optionalEndDate(value: unknown): string | null {
  if (value == null || String(value).trim() === "") return null;
  return isoDate(value, "End date");
}

export type MilestonePatch = {
  title?: string;
  kind?: MilestoneKind;
  startsOn?: string;
  endsOn?: string | null;
  notes?: string;
  meetingUrl?: string | null;
};

export type CalendarAction =
  | { action: "seed_season"; orgId: string; kickoffDate: string }
  | {
      action: "add_milestone";
      orgId: string;
      title: string;
      kind: MilestoneKind;
      startsOn: string;
      endsOn: string | null;
      notes: string;
      meetingUrl: string | null;
    }
  | { action: "update_milestone"; orgId: string; id: string; patch: MilestonePatch }
  | { action: "toggle_done"; orgId: string; id: string; done: boolean }
  | { action: "delete_milestone"; orgId: string; id: string };

export function parseCalendarAction(input: unknown): CalendarAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid calendar action");
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  const orgId = uuid(body.orgId, "Organization");

  switch (action) {
    case "seed_season":
      return { action, orgId, kickoffDate: isoDate(body.kickoffDate, "Kickoff date") };

    case "add_milestone": {
      const startsOn = isoDate(body.startsOn, "Start date");
      const endsOn = optionalEndDate(body.endsOn);
      if (endsOn && endsOn < startsOn) throw new Error("End date must be on or after the start date");
      return {
        action,
        orgId,
        title: requiredText(body.title, "Milestone title", 160),
        kind: milestoneKind(body.kind),
        startsOn,
        endsOn,
        notes: optionalText(body.notes, 2000) ?? "",
        meetingUrl: optionalMeetingUrl(body.meetingUrl),
      };
    }

    case "update_milestone": {
      const id = uuid(body.id, "Milestone");
      const source =
        body.patch && typeof body.patch === "object" && !Array.isArray(body.patch)
          ? (body.patch as Record<string, unknown>)
          : {};
      const patch: MilestonePatch = {};
      if (Object.prototype.hasOwnProperty.call(source, "title")) {
        patch.title = requiredText(source.title, "Milestone title", 160);
      }
      if (Object.prototype.hasOwnProperty.call(source, "kind")) {
        patch.kind = milestoneKind(source.kind);
      }
      if (Object.prototype.hasOwnProperty.call(source, "startsOn")) {
        patch.startsOn = isoDate(source.startsOn, "Start date");
      }
      if (Object.prototype.hasOwnProperty.call(source, "endsOn")) {
        patch.endsOn = optionalEndDate(source.endsOn);
      }
      if (Object.prototype.hasOwnProperty.call(source, "notes")) {
        patch.notes = optionalText(source.notes, 2000) ?? "";
      }
      if (Object.prototype.hasOwnProperty.call(source, "meetingUrl")) {
        patch.meetingUrl = optionalMeetingUrl(source.meetingUrl);
      }
      if (Object.keys(patch).length === 0) throw new Error("No changes provided");
      if (patch.startsOn && patch.endsOn && patch.endsOn < patch.startsOn) {
        throw new Error("End date must be on or after the start date");
      }
      return { action, orgId, id, patch };
    }

    case "toggle_done":
      return { action, orgId, id: uuid(body.id, "Milestone"), done: Boolean(body.done) };

    case "delete_milestone":
      return { action, orgId, id: uuid(body.id, "Milestone") };

    default:
      throw new Error("Unsupported calendar action");
  }
}
