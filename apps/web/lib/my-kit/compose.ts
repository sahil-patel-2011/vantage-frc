/**
 * My kit — pure composition. No I/O, no framework, deterministic given its input.
 *
 * Everything here is a fusion of records the loader already read from surfaces that
 * own them. This module invents nothing: if a list is empty it stays empty, and if a
 * table is missing the section says so rather than showing a plausible-looking zero.
 */

import { matchSubteamTracks } from "../role-onboarding/assign";
import { withOrgHref } from "../nav/product-nav";
import type {
  MyKitAvailability,
  MyKitComposeInput,
  MyKitFocus,
  MyKitHourLogRecord,
  MyKitHours,
  MyKitPackingRecord,
  MyKitQuickLink,
  MyKitRow,
  MyKitSection,
  MyKitSectionId,
  MyKitSetupStep,
  MyKitTone,
  MyKitView,
} from "./types";

export const MY_KIT_SECTION_IDS: MyKitSectionId[] = [
  "tasks",
  "packing",
  "calendar",
  "duties",
  "scouting",
  "media",
  "hours",
  "learning",
  "skills",
  "tools",
  "money",
  "onboarding",
];

export const EMPTY_AVAILABILITY: MyKitAvailability = {
  tasks: false,
  packing: false,
  calendar: false,
  duties: false,
  scouting: false,
  media: false,
  hours: false,
  learning: false,
  skills: false,
  tools: false,
  money: false,
  onboarding: false,
};

// ---------------------------------------------------------------------------
// Time helpers — UTC day keys so results are identical in every timezone.
// ---------------------------------------------------------------------------

/** Milliseconds for an ISO instant, or a date-only value read as end of that UTC day. */
export function toInstant(value: string | null | undefined): number | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59.999Z` : raw;
  const ms = new Date(dateOnly).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function dayKeyUtc(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
}

function shiftDayKey(dayKey: string, deltaDays: number): string {
  const ms = new Date(`${dayKey}T00:00:00.000Z`).getTime() + deltaDays * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function minutesBetween(startIso: string, endIso: string | null): number {
  const start = toInstant(startIso);
  const end = toInstant(endIso);
  if (start == null || end == null || end <= start) return 0;
  return Math.round((end - start) / 60_000);
}

const DUE_SOON_MS = 72 * 60 * 60 * 1000;

/**
 * Due tonight or already overdue (UTC day). Used for assigned work that has a
 * due date — an undated assignment is not assumed to be tonight.
 */
export function isDueByTonight(due: string | null | undefined, nowIso: string): boolean {
  const today = dayKeyUtc(nowIso);
  const key = dayKeyUtc(due);
  return Boolean(today && key && key <= today);
}

/** Starts on tonight's UTC calendar day. Missing timestamps are not guessed. */
export function isOnTonight(when: string | null | undefined, nowIso: string): boolean {
  const today = dayKeyUtc(nowIso);
  const key = dayKeyUtc(when);
  return Boolean(today && key && key === today);
}

export const TONIGHT_EMPTY_LABEL =
  "Nothing is assigned to you for tonight, and you have no packing items of your own.";

/** Overdue / due-soon / neutral. Never guesses when the due value is absent. */
export function dueTone(due: string | null | undefined, nowIso: string): MyKitTone {
  const dueMs = toInstant(due);
  const nowMs = toInstant(nowIso);
  if (dueMs == null || nowMs == null) return "neutral";
  if (dueMs < nowMs) return "overdue";
  if (dueMs - nowMs <= DUE_SOON_MS) return "due";
  return "neutral";
}

/** "Mar 4" / "Mar 4, 6:30 PM" — stable, locale-independent, UTC. */
export function formatWhen(value: string | null | undefined, opts?: { time?: boolean }): string {
  const ms = toInstant(value);
  if (ms == null) return "";
  const date = new Date(ms);
  const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = date.getUTCDate();
  if (!opts?.time) return `${month} ${day}`;
  const hours24 = date.getUTCHours();
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day}, ${hours12}:${minutes} ${suffix}`;
}

// ---------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------

/**
 * Total logged minutes, session count, and the current streak.
 *
 * Streak = consecutive UTC days with at least one log, counting back from the most
 * recent logged day. It only counts as *current* when that day is today or yesterday;
 * a streak that ended last month is honestly 0, not a stale number.
 */
export function summarizeHours(logs: MyKitHourLogRecord[], nowIso: string): MyKitHours {
  let totalMinutes = 0;
  let openSession = false;
  const days = new Set<string>();

  for (const log of logs) {
    totalMinutes += minutesBetween(log.clockIn, log.clockOut);
    if (!log.clockOut) openSession = true;
    const key = dayKeyUtc(log.clockIn);
    if (key) days.add(key);
  }

  const sorted = [...days].sort().reverse();
  const lastLoggedOn = sorted[0] ?? null;
  const today = dayKeyUtc(nowIso);

  let streakDays = 0;
  if (lastLoggedOn && today) {
    const yesterday = shiftDayKey(today, -1);
    if (lastLoggedOn === today || lastLoggedOn === yesterday) {
      let cursor = lastLoggedOn;
      for (const key of sorted) {
        if (key !== cursor) break;
        streakDays += 1;
        cursor = shiftDayKey(cursor, -1);
      }
    }
  }

  return {
    totalMinutes,
    sessionCount: logs.length,
    streakDays,
    lastLoggedOn,
    openSession,
  };
}

export function formatHours(minutes: number): string {
  return `${Math.round((minutes / 60) * 10) / 10}h`;
}

// ---------------------------------------------------------------------------
// Focus — which subteam lens leads
// ---------------------------------------------------------------------------

/**
 * Media reads as "business" in the shared role-onboarding keyword map, but a media
 * member's day is content deadlines, not sponsor asks. Check media first, then defer
 * to the app's existing subteam → track mapping for everything else.
 */
const MEDIA_KEYWORDS = ["media", "photo", "video", "social", "content", "marketing", "communications"];

const TRACK_FOCUS: Record<string, MyKitFocus> = {
  scouting: "scouting",
  electrical: "electrical",
  programming: "programming",
  mechanical: "mechanical",
  cad: "cad",
  drive_team: "drive_team",
  business: "business",
  safety: "safety",
};

const FOCUS_LABEL: Record<MyKitFocus, string> = {
  scouting: "Scouting / strategy",
  media: "Media",
  electrical: "Electrical",
  programming: "Programming",
  mechanical: "Mechanical",
  cad: "CAD",
  drive_team: "Drive team",
  business: "Business / awards",
  safety: "Safety",
  general: "Whole team",
};

export function focusLabel(focus: MyKitFocus): string {
  return FOCUS_LABEL[focus];
}

/** Every role-onboarding track key matched by this person's subteam names. */
export function trackKeysFor(subteamNames: string[]): string[] {
  const out: string[] = [];
  for (const name of subteamNames) {
    for (const key of matchSubteamTracks(name)) {
      if (!out.includes(key)) out.push(key);
    }
  }
  return out;
}

export function deriveFocus(subteamNames: string[]): MyKitFocus {
  for (const name of subteamNames) {
    const hay = name.trim().toLowerCase();
    if (hay && MEDIA_KEYWORDS.some((kw) => hay.includes(kw))) return "media";
  }
  for (const name of subteamNames) {
    for (const key of matchSubteamTracks(name)) {
      const focus = TRACK_FOCUS[key];
      if (focus) return focus;
    }
  }
  return "general";
}

const BASE_ORDER: MyKitSectionId[] = [...MY_KIT_SECTION_IDS];

const PROMOTIONS: Record<MyKitFocus, MyKitSectionId[]> = {
  scouting: ["scouting", "duties", "calendar", "tasks", "packing"],
  media: ["media", "calendar", "tasks", "packing"],
  drive_team: ["duties", "calendar", "tasks", "packing"],
  electrical: ["tasks", "packing", "calendar", "tools"],
  programming: ["tasks", "packing", "calendar", "learning"],
  mechanical: ["tasks", "packing", "tools", "calendar"],
  cad: ["tasks", "packing", "calendar", "learning"],
  business: ["tasks", "packing", "money", "calendar"],
  safety: ["skills", "tasks", "packing", "calendar"],
  general: ["tasks", "packing"],
};

const EMPHASIS_REASON: Record<MyKitFocus, string> = {
  scouting: "Scouting is your subteam, so assignments lead.",
  media: "Media is your subteam, so content deadlines lead.",
  drive_team: "Drive team is your subteam, so duty shifts lead.",
  electrical: "Electrical is your subteam, so open work leads.",
  programming: "Programming is your subteam, so open work leads.",
  mechanical: "Mechanical is your subteam, so open work leads.",
  cad: "CAD is your subteam, so open work leads.",
  business: "Business is your subteam, so open work leads.",
  safety: "Safety is your subteam, so certifications lead.",
  general: "",
};

/** Focus-first section order. Every section id appears exactly once. */
export function sectionOrder(focus: MyKitFocus): MyKitSectionId[] {
  const promoted = PROMOTIONS[focus];
  const rest = BASE_ORDER.filter((id) => !promoted.includes(id));
  return [...promoted, ...rest];
}

const FOCUS_LINKS: Record<MyKitFocus, MyKitQuickLink[]> = {
  scouting: [
    { id: "scouting", label: "Scouting Hub", href: "/scouting" },
    { id: "lineup", label: "Lineup", href: "/scouting/lineup" },
    { id: "strategy", label: "Strategy", href: "/strategy" },
  ],
  media: [
    { id: "media", label: "Media", href: "/media" },
    { id: "media-kit", label: "Media kit", href: "/media-kit" },
    { id: "showcase", label: "Showcase", href: "/showcase" },
  ],
  electrical: [
    { id: "wiring", label: "Wiring", href: "/wiring" },
    { id: "control-map", label: "Control map", href: "/control-map" },
    { id: "power-budget", label: "Power budget", href: "/power-budget" },
    { id: "batteries", label: "Batteries", href: "/batteries" },
  ],
  programming: [
    { id: "code", label: "Code", href: "/code" },
    { id: "software-versions", label: "Software versions", href: "/software-versions" },
    { id: "control-map", label: "Control map", href: "/control-map" },
  ],
  mechanical: [
    { id: "build", label: "Build", href: "/build" },
    { id: "inventory", label: "Inventory", href: "/inventory" },
    { id: "fmea", label: "Failure log", href: "/fmea" },
  ],
  cad: [
    { id: "cad", label: "CAD", href: "/cad" },
    { id: "cad-vault", label: "CAD vault", href: "/cad-vault" },
    { id: "decisions", label: "Decisions", href: "/decisions" },
  ],
  drive_team: [
    { id: "practice", label: "Practice", href: "/practice" },
    { id: "match-checklist", label: "Match checklist", href: "/match-checklist" },
    { id: "my-day", label: "My Day", href: "/my-day" },
  ],
  business: [
    { id: "business", label: "Business Hub", href: "/business" },
    { id: "sponsors", label: "Sponsors", href: "/team/sponsors" },
    { id: "grants", label: "Grants", href: "/team/grants" },
  ],
  safety: [
    { id: "safety-training", label: "Safety training", href: "/safety-training" },
    { id: "safety", label: "Safety log", href: "/safety" },
    { id: "incidents", label: "Incidents", href: "/incidents" },
  ],
  general: [
    { id: "team", label: "Team hub", href: "/team" },
    { id: "calendar", label: "Calendar", href: "/team/calendar" },
    { id: "todos", label: "Work", href: "/todos" },
  ],
};

export function focusLinks(focus: MyKitFocus, orgId: string | null): MyKitQuickLink[] {
  return FOCUS_LINKS[focus].map((link) => ({ ...link, href: withOrgHref(link.href, orgId) }));
}

// ---------------------------------------------------------------------------
// Setup gate
// ---------------------------------------------------------------------------

export const MY_KIT_SETUP_STEPS: MyKitSetupStep[] = [
  {
    id: "workspace",
    label: "Choose your team",
    detail: "My kit reads your own rows inside one team, so it needs to know which team.",
    href: "/workspace",
  },
];

export function myKitSetupRequired(
  orgId: string | null = null,
  message = "Choose your team to open My kit.",
): Extract<MyKitView, { status: "setup_required" }> {
  return { status: "setup_required", message, steps: MY_KIT_SETUP_STEPS, orgId };
}

// ---------------------------------------------------------------------------
// Section metadata
// ---------------------------------------------------------------------------

type SectionMeta = { title: string; href: string; emptyLabel: string };

const SECTION_META: Record<MyKitSectionId, SectionMeta> = {
  tasks: {
    title: "My open work",
    href: "/todos",
    emptyLabel: "No open tasks are assigned to you right now.",
  },
  packing: {
    title: "My packing",
    href: "/packing",
    emptyLabel: "No packing items belong to you. The standard load-out template is not your kit.",
  },
  calendar: {
    title: "My next meetings",
    href: "/team/calendar",
    emptyLabel: "Nothing upcoming on your subteam calendars.",
  },
  duties: {
    title: "My duty shifts",
    href: "/duties",
    emptyLabel: "No duty shifts are assigned to you.",
  },
  scouting: {
    title: "My scouting assignments",
    href: "/scouting/lineup",
    emptyLabel: "No scouting assignments for you at the active event.",
  },
  media: {
    title: "My content deadlines",
    href: "/media",
    emptyLabel: "No content items are assigned to you.",
  },
  hours: {
    title: "My hours",
    href: "/hours-self-view",
    emptyLabel: "No hours logged under your name yet.",
  },
  learning: {
    title: "My learning ledger",
    href: "/learning",
    emptyLabel: "You have not called a prediction yet.",
  },
  skills: {
    title: "My skills and certifications",
    href: "/skills-graph",
    emptyLabel: "No skills or safety certifications recorded for you.",
  },
  tools: {
    title: "Tools I have out",
    href: "/tool-checkout",
    emptyLabel: "Nothing is checked out in your name.",
  },
  money: {
    title: "My requests and reimbursements",
    href: "/orders",
    emptyLabel: "You have no open purchase requests or reimbursements.",
  },
  onboarding: {
    title: "My onboarding track",
    href: "/start",
    emptyLabel: "No onboarding track has been assigned to you yet.",
  },
};

const UNAVAILABLE_HINT = "This team's deployment does not have this feature's tables yet.";

function section(
  id: MyKitSectionId,
  rows: MyKitRow[],
  availability: MyKitAvailability,
  orgId: string,
  opts?: { reason?: string; emphasis?: boolean },
): MyKitSection {
  const meta = SECTION_META[id];
  const available = availability[id];
  return {
    id,
    title: meta.title,
    reason: opts?.reason ?? "",
    href: withOrgHref(meta.href, orgId),
    available,
    rows: available ? rows : [],
    emptyLabel: available ? meta.emptyLabel : UNAVAILABLE_HINT,
    emphasis: opts?.emphasis ?? false,
    actionable: available
      ? rows.filter((row) => row.tone === "overdue" || row.tone === "due").length
      : 0,
  };
}

// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<string, string> = {
  todo: "To do",
  doing: "Doing",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  ordered: "Ordered",
  received: "Received",
  draft: "Draft",
  scheduled: "Scheduled",
  posted: "Posted",
  submitted: "Submitted",
  paid: "Paid",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

function joinDetail(...parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0)
    .join(" · ");
}

function packingRows(items: MyKitPackingRecord[], orgId: string): MyKitRow[] {
  return items.map((item) => {
    const qty = item.quantity > 1 ? `×${item.quantity}` : "";
    if (item.packed || item.status === "packed") {
      return {
        id: `packing:${item.source}:${item.id}`,
        title: item.label,
        detail: joinDetail(item.listTitle, item.category, qty),
        meta: "Packed",
        href: withOrgHref("/packing", orgId),
        tone: "done" as const,
      };
    }
    return {
      id: `packing:${item.source}:${item.id}`,
      title: item.label,
      detail: joinDetail(
        item.listTitle,
        item.category,
        qty,
        item.status === "pending" ? "You requested this" : "On the list",
      ),
      meta: item.status === "pending" ? "Pending" : "Still unpacked",
      href: withOrgHref("/packing", orgId),
      tone: "due" as const,
    };
  });
}

/** Assigned work that is due by tonight, plus unpacked packing that belongs to this member. */
export function tonightRows(input: {
  nowIso: string;
  taskRows: MyKitRow[];
  tasks: MyKitComposeInput["tasks"];
  eventRows: MyKitRow[];
  events: MyKitComposeInput["events"];
  dutyRows: MyKitRow[];
  duties: MyKitComposeInput["duties"];
  scoutRows: MyKitRow[];
  scoutAssignments: MyKitComposeInput["scoutAssignments"];
  mediaRows: MyKitRow[];
  media: MyKitComposeInput["media"];
  packingRows: MyKitRow[];
  packing: MyKitPackingRecord[];
}): { rows: MyKitRow[]; assignmentCount: number; packingCount: number } {
  const now = input.nowIso;
  const picked: MyKitRow[] = [];

  input.tasks.forEach((task, index) => {
    const dueTonight = task.dueOn ? isDueByTonight(task.dueOn, now) : true;
    if (dueTonight) picked.push(input.taskRows[index]!);
  });
  input.events.forEach((event, index) => {
    if (isOnTonight(event.startsAt, now)) picked.push(input.eventRows[index]!);
  });
  input.duties.forEach((duty, index) => {
    if (isOnTonight(duty.startsAt, now)) picked.push(input.dutyRows[index]!);
  });
  input.scoutAssignments.forEach((entry, index) => {
    if (!entry.startsAt || isOnTonight(entry.startsAt, now)) picked.push(input.scoutRows[index]!);
  });
  input.media.forEach((item, index) => {
    if (item.dueAt ? isDueByTonight(item.dueAt, now) : true) picked.push(input.mediaRows[index]!);
  });

  const assignmentCount = picked.length;
  const packingNeeded = input.packing
    .map((item, index) => ({ item, row: input.packingRows[index]! }))
    .filter(({ item }) => !item.packed && item.status !== "packed");
  for (const { row } of packingNeeded) picked.push(row);

  return { rows: picked.filter(Boolean), assignmentCount, packingCount: packingNeeded.length };
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

/** Build the whole per-person view. Pure: same input, same output, every time. */
export function composeMyKit(input: MyKitComposeInput): Extract<MyKitView, { status: "live" }> {
  const orgId = input.orgId;
  const now = input.nowIso;
  const subteamNames = input.subteams.map((entry) => entry.name);
  const focus = deriveFocus(subteamNames);

  const taskRows: MyKitRow[] = input.tasks.map((task) => ({
    id: `${task.source}:${task.id}`,
    title: task.title,
    detail: joinDetail(
      task.source === "build_task" ? "Build task" : "Team todo",
      task.context,
      task.priority && task.priority !== "normal" ? `${task.priority} priority` : "",
    ),
    meta: task.dueOn ? `Due ${formatWhen(task.dueOn)}` : statusLabel(task.status),
    href: withOrgHref(task.source === "build_task" ? "/tasks" : "/todos", orgId),
    tone: dueTone(task.dueOn, now),
  }));

  const eventRows: MyKitRow[] = input.events.map((event) => ({
    id: `event:${event.id}`,
    title: event.title,
    detail: joinDetail(
      event.subteamName || "Whole team",
      event.location,
      event.rsvp ? `You said ${event.rsvp}` : "",
    ),
    meta: formatWhen(event.startsAt, { time: true }),
    href: withOrgHref("/team/calendar", orgId),
    tone: dueTone(event.startsAt, now) === "overdue" ? "info" : dueTone(event.startsAt, now),
  }));

  const dutyRows: MyKitRow[] = input.duties.map((duty) => ({
    id: `duty:${duty.id}`,
    title: duty.title,
    detail: joinDetail(statusLabel(duty.kind), duty.notes),
    meta: formatWhen(duty.startsAt, { time: true }),
    href: withOrgHref("/duties", orgId),
    tone: dueTone(duty.startsAt, now) === "overdue" ? "info" : dueTone(duty.startsAt, now),
  }));

  const scoutRows: MyKitRow[] = input.scoutAssignments.map((entry) => ({
    id: `scout:${entry.id}`,
    title: `${entry.matchKey} · ${entry.teamKey.replace(/^frc/i, "")}`,
    detail: joinDetail(entry.eventKey, entry.role === "primary" ? "" : entry.role),
    meta: entry.startsAt ? formatWhen(entry.startsAt, { time: true }) : "",
    href: withOrgHref("/scouting/lineup", orgId),
    tone: entry.startsAt ? dueTone(entry.startsAt, now) : "neutral",
  }));
  if (input.scoutAccuracy) {
    const accuracy = input.scoutAccuracy;
    scoutRows.push({
      id: "scout-accuracy",
      title: `Accuracy ${Math.round(accuracy.accuracyScore)}%`,
      detail: joinDetail(
        `${accuracy.entriesScored} scored ${accuracy.entriesScored === 1 ? "entry" : "entries"}`,
        accuracy.rank != null ? `Rank ${accuracy.rank} of ${accuracy.scoutsScored}` : "",
        accuracy.eventKey,
      ),
      meta: `Scored ${formatWhen(accuracy.computedAt)}`,
      href: withOrgHref("/scout-accuracy", orgId),
      tone: "info",
    });
  }

  const mediaRows: MyKitRow[] = input.media.map((item) => ({
    id: `media:${item.id}`,
    title: item.title,
    detail: joinDetail(item.platform, statusLabel(item.status)),
    meta: item.dueAt ? `Due ${formatWhen(item.dueAt, { time: true })}` : statusLabel(item.status),
    href: withOrgHref("/media", orgId),
    tone: dueTone(item.dueAt, now),
  }));

  const hours = summarizeHours(input.hourLogs, now);
  const hourRows: MyKitRow[] = input.hourLogs.slice(0, 5).map((log) => ({
    id: `hours:${log.id}`,
    title: `${statusLabel(log.kind)} · ${formatWhen(log.clockIn)}`,
    detail: log.clockOut ? formatHours(minutesBetween(log.clockIn, log.clockOut)) : "Still clocked in",
    meta: log.clockOut ? "" : "Open",
    href: withOrgHref("/hours-self-view", orgId),
    tone: log.clockOut ? "done" : "info",
  }));

  const learningRows: MyKitRow[] = [];
  if (input.learning && input.learning.total > 0) {
    const ledger = input.learning;
    const graded = ledger.spotOn + ledger.close + ledger.off;
    learningRows.push({
      id: "learning:summary",
      title: `${ledger.total} ${ledger.total === 1 ? "call" : "calls"} logged`,
      detail: joinDetail(
        graded > 0 ? `${ledger.spotOn} spot-on · ${ledger.close} close · ${ledger.off} off` : "",
        ledger.skipped > 0 ? `${ledger.skipped} skipped` : "",
      ),
      meta: ledger.lastAt ? `Last ${formatWhen(ledger.lastAt)}` : "",
      href: withOrgHref("/learning", orgId),
      tone: "info",
    });
  }

  const skillRows: MyKitRow[] = [
    ...input.skills.map((skill) => ({
      id: `skill:${skill.id}`,
      title: skill.label,
      detail: statusLabel(skill.proficiency),
      meta: "Skill",
      href: withOrgHref("/skills-graph", orgId),
      tone: "info" as MyKitTone,
    })),
    ...input.certifications.map((cert) => {
      const expiryTone = dueTone(cert.expiresOn, now);
      return {
        id: `cert:${cert.id}`,
        title: statusLabel(cert.certType),
        detail: `Certified ${formatWhen(cert.completedOn)}`,
        meta: cert.expiresOn
          ? expiryTone === "overdue"
            ? `Expired ${formatWhen(cert.expiresOn)}`
            : `Expires ${formatWhen(cert.expiresOn)}`
          : "Certification",
        href: withOrgHref("/safety-training", orgId),
        tone: expiryTone === "neutral" ? ("done" as MyKitTone) : expiryTone,
      };
    }),
  ];

  const toolRows: MyKitRow[] = input.tools.map((loan) => ({
    id: `tool:${loan.id}`,
    title: loan.toolName,
    detail: `Out since ${formatWhen(loan.checkedOutAt)}`,
    meta: loan.dueAt ? `Due ${formatWhen(loan.dueAt)}` : "No due date",
    href: withOrgHref("/tool-checkout", orgId),
    tone: dueTone(loan.dueAt, now),
  }));

  const moneyRows: MyKitRow[] = input.money.map((entry) => ({
    id: `money:${entry.source}:${entry.id}`,
    title: entry.title,
    detail: joinDetail(
      entry.source === "purchase_request" ? "Purchase request" : "Reimbursement",
      entry.createdAt ? `Filed ${formatWhen(entry.createdAt)}` : "",
    ),
    meta: joinDetail(
      statusLabel(entry.status),
      entry.amountUsd != null ? `$${entry.amountUsd.toFixed(2)}` : "",
    ),
    href: withOrgHref(entry.source === "purchase_request" ? "/orders" : "/team/finance", orgId),
    tone: entry.status === "pending" || entry.status === "submitted" ? "due" : "info",
  }));

  const onboardingRows: MyKitRow[] = input.onboarding.map((track) => ({
    id: `track:${track.trackKey}`,
    title: track.title,
    detail: `${track.done} of ${track.total} steps done`,
    meta: track.total > 0 && track.done >= track.total ? "Complete" : "In progress",
    href: withOrgHref("/start", orgId),
    tone: track.total > 0 && track.done >= track.total ? "done" : "due",
  }));

  const packRows = packingRows(input.availability.packing ? input.packing : [], orgId);
  const tonight = tonightRows({
    nowIso: now,
    taskRows,
    tasks: input.tasks,
    eventRows,
    events: input.events,
    dutyRows,
    duties: input.duties,
    scoutRows,
    scoutAssignments: input.scoutAssignments,
    mediaRows,
    media: input.media,
    packingRows: packRows,
    packing: input.availability.packing ? input.packing : [],
  });

  const order = sectionOrder(focus);
  const emphasisId = PROMOTIONS[focus][0] ?? null;
  const emphasisReason = EMPHASIS_REASON[focus];

  const rowsById: Record<MyKitSectionId, MyKitRow[]> = {
    tasks: taskRows,
    packing: packRows,
    calendar: eventRows,
    duties: dutyRows,
    scouting: scoutRows,
    media: mediaRows,
    hours: hourRows,
    learning: learningRows,
    skills: skillRows,
    tools: toolRows,
    money: moneyRows,
    onboarding: onboardingRows,
  };

  const sections = order.map((id) =>
    section(id, rowsById[id], input.availability, orgId, {
      emphasis: id === emphasisId,
      reason: id === emphasisId ? emphasisReason : "",
    }),
  );

  return {
    status: "live",
    orgId,
    orgName: input.orgName,
    teamNumber: input.teamNumber,
    person: {
      userId: input.userId,
      displayName: input.displayName,
      orgRole: input.orgRole,
      teamRole: input.teamRole,
      subteams: input.subteams,
      focus,
      focusLabel: focusLabel(focus),
      trackKeys: trackKeysFor(subteamNames),
    },
    tonight: {
      date: dayKeyUtc(now) ?? now.slice(0, 10),
      rows: tonight.rows,
      assignmentCount: tonight.assignmentCount,
      packingCount: tonight.packingCount,
      emptyLabel: TONIGHT_EMPTY_LABEL,
    },
    sections,
    hours,
    quickLinks: focusLinks(focus, orgId),
    actionableCount: sections.reduce((sum, entry) => sum + entry.actionable, 0),
    unavailableSections: sections.filter((entry) => !entry.available).map((entry) => entry.id),
    computedAt: now,
  };
}
