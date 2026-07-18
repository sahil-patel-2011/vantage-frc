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

/** Read-only business / purchase dates surfaced beside the milestone plan (not seeded stats). */
export type LinkedDeadline = {
  id: string;
  source: "grant" | "purchase";
  title: string;
  dueOn: string;
  href: string;
};

export type CalendarContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
};

export type CalendarView =
  | {
      status: "ready";
      context: CalendarContext;
      milestones: Milestone[];
      linkedDeadlines: LinkedDeadline[];
      templates: Array<{ id: SeasonTemplateId; label: string; description: string; entryCount: number }>;
    }
  | { status: "setup_required"; context: CalendarContext; message: string };

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

// ---------------------------------------------------------------------------
// Opt-in season templates (offsets relative to Kickoff day 0). Leads customize
// after seeding — nothing is auto-inserted as live competition stats.
// ---------------------------------------------------------------------------

export type SeasonTemplateId =
  | "build_season"
  | "stop_build_ship"
  | "competition_markers"
  | "outreach"
  | "full_season";

export type TemplateEntry = {
  offsetDays: number;
  title: string;
  kind: MilestoneKind;
  notes?: string;
  /** Optional inclusive span; endsOn = startsOn + spanDays when set. */
  spanDays?: number;
};

export type SeasonTemplate = {
  id: SeasonTemplateId;
  label: string;
  description: string;
  entries: TemplateEntry[];
};

const BUILD_ENTRIES: TemplateEntry[] = [
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

const STOP_BUILD_ENTRIES: TemplateEntry[] = [
  {
    offsetDays: 45,
    title: "Stop-build / bag day",
    kind: "deadline",
    notes: "Adjust to your district / regional stop-build rule. Customize after seeding.",
  },
  { offsetDays: 46, title: "Spare parts & tools crate packed", kind: "deadline" },
  { offsetDays: 48, title: "Self-inspection & weigh-in ready", kind: "deadline" },
  { offsetDays: 50, title: "Ship / load trailer for Week 1 event", kind: "deadline" },
  { offsetDays: 51, title: "Pit binder & awards materials ready", kind: "deadline" },
];

const COMPETITION_ENTRIES: TemplateEntry[] = [
  {
    offsetDays: 56,
    title: "Week 1 event",
    kind: "event",
    spanDays: 2,
    notes: "Replace with your real event name and dates after seeding.",
  },
  {
    offsetDays: 70,
    title: "Week 2 / second event",
    kind: "event",
    spanDays: 2,
    notes: "Optional — delete if you only play one event.",
  },
  {
    offsetDays: 90,
    title: "District / regional championships",
    kind: "event",
    spanDays: 2,
    notes: "Placeholder — set real championship dates when published.",
  },
];

const OUTREACH_ENTRIES: TemplateEntry[] = [
  { offsetDays: -30, title: "Preseason recruitment open house", kind: "outreach" },
  { offsetDays: 10, title: "Kickoff demo / community night", kind: "outreach" },
  { offsetDays: 30, title: "School visit / STEM classroom demo", kind: "outreach" },
  { offsetDays: 40, title: "Sponsor appreciation night", kind: "outreach" },
  { offsetDays: 75, title: "Post-event impact write-up due", kind: "deadline" },
];

function mergeUnique(groups: TemplateEntry[][]): TemplateEntry[] {
  const seen = new Set<string>();
  const out: TemplateEntry[] = [];
  for (const group of groups) {
    for (const entry of group) {
      if (seen.has(entry.title)) continue;
      seen.add(entry.title);
      out.push(entry);
    }
  }
  return out.sort((a, b) => a.offsetDays - b.offsetDays || a.title.localeCompare(b.title));
}

export const SEASON_TEMPLATES: SeasonTemplate[] = [
  {
    id: "build_season",
    label: "Build season arc",
    description: "Classic ~8-week plan from kickoff through design freeze, drivetrain, integration, and feature freeze.",
    entries: BUILD_ENTRIES,
  },
  {
    id: "stop_build_ship",
    label: "Stop-build & ship",
    description: "Bag day, spare crate, self-inspection, trailer load, and pit/awards pack deadlines.",
    entries: STOP_BUILD_ENTRIES,
  },
  {
    id: "competition_markers",
    label: "Competition markers",
    description: "Placeholder Week 1 / Week 2 / championships event blocks — rename to your real events.",
    entries: COMPETITION_ENTRIES,
  },
  {
    id: "outreach",
    label: "Outreach & impact",
    description: "Recruitment, demos, sponsor night, and a post-event impact write-up marker.",
    entries: OUTREACH_ENTRIES,
  },
  {
    id: "full_season",
    label: "Typical FRC season (all)",
    description: "Build arc + stop-build/ship + competition placeholders + outreach — seed once, then customize.",
    entries: mergeUnique([BUILD_ENTRIES, STOP_BUILD_ENTRIES, COMPETITION_ENTRIES, OUTREACH_ENTRIES]),
  },
];

export const SEASON_TEMPLATE_IDS = SEASON_TEMPLATES.map((template) => template.id) as SeasonTemplateId[];

/** @deprecated Prefer SEASON_TEMPLATES.find(t => t.id === "build_season") — kept for existing imports/tests. */
export const SEASON_TEMPLATE: TemplateEntry[] = BUILD_ENTRIES;

export function getSeasonTemplate(id: SeasonTemplateId): SeasonTemplate {
  const found = SEASON_TEMPLATES.find((template) => template.id === id);
  if (!found) throw new Error("Season template is invalid");
  return found;
}

export function listSeasonTemplates(): Array<{
  id: SeasonTemplateId;
  label: string;
  description: string;
  entryCount: number;
}> {
  return SEASON_TEMPLATES.map((template) => ({
    id: template.id,
    label: template.label,
    description: template.description,
    entryCount: template.entries.length,
  }));
}

export type SeededMilestone = {
  title: string;
  kind: MilestoneKind;
  startsOn: string;
  endsOn: string | null;
  notes: string;
};

/** Date every template entry relative to the given kickoff date. */
export function seedFromKickoff(
  kickoffDate: string,
  templateId: SeasonTemplateId = "build_season",
): SeededMilestone[] {
  const template = getSeasonTemplate(templateId);
  return template.entries.map((entry) => {
    const startsOn = addDays(kickoffDate, entry.offsetDays);
    const endsOn =
      entry.spanDays != null && entry.spanDays > 0 ? addDays(startsOn, entry.spanDays) : null;
    return {
      title: entry.title,
      kind: entry.kind,
      startsOn,
      endsOn,
      notes: entry.notes ?? "",
    };
  });
}

/** Soft deep-links from a milestone kind into related team surfaces. */
export function milestoneWorkflowLinks(
  milestone: Pick<Milestone, "kind">,
  orgId: string,
): Array<{ href: string; label: string }> {
  const q = `?orgId=${encodeURIComponent(orgId)}`;
  switch (milestone.kind) {
    case "kickoff":
    case "design":
      return [{ href: `/kickoff${q}`, label: "Kickoff analysis" }];
    case "practice":
      return [{ href: `/practice${q}`, label: "Practice planner" }];
    case "event":
      return [
        { href: `/event-readiness${q}`, label: "Event readiness" },
        { href: `/packing${q}`, label: "Packing" },
      ];
    case "deadline":
      return [
        { href: `/business${q}`, label: "Business deadlines" },
        { href: `/costs${q}`, label: "Season costs" },
      ];
    case "outreach":
      return [
        { href: `/impact${q}`, label: "Impact" },
        { href: `/business${q}`, label: "Sponsors & grants" },
      ];
    default:
      return [];
  }
}

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

function seasonTemplateId(value: unknown): SeasonTemplateId {
  if (value == null || String(value).trim() === "") return "build_season";
  const text = requiredText(value, "Template", 40);
  if (!(SEASON_TEMPLATE_IDS as readonly string[]).includes(text)) throw new Error("Season template is invalid");
  return text as SeasonTemplateId;
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
  | { action: "seed_season"; orgId: string; kickoffDate: string; templateId: SeasonTemplateId }
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
      return {
        action,
        orgId,
        kickoffDate: isoDate(body.kickoffDate, "Kickoff date"),
        templateId: seasonTemplateId(body.templateId),
      };

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
