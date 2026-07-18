// Pure helper functions for the morning standup digest — no I/O, unit-testable.
// Every value here is derived strictly from the rows callers pass in; nothing is fabricated
// when a subteam/day has no activity — it is simply absent from the resulting lists.

import type {
  StandupAttendanceEvent,
  StandupAttendanceSummary,
  StandupBlocker,
  StandupDigestSummary,
  StandupHoursContributor,
  StandupHoursSummary,
  StandupKnowledgeEdit,
  StandupSubteamBrief,
  StandupTaskMovement,
  TaskMovementEvent,
} from "./types";

const DEFAULT_SUBTEAM = "general";

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Yesterday (UTC calendar day) relative to `now`, as an ISO date (YYYY-MM-DD). */
export function defaultDigestDate(now: Date = new Date()): string {
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return yesterday.toISOString().slice(0, 10);
}

/** [00:00:00, next-day 00:00:00) UTC window for a given ISO calendar date. */
export function windowForDate(digestDate: string): { windowStart: string; windowEnd: string } {
  const start = new Date(`${digestDate}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { windowStart: start.toISOString(), windowEnd: end.toISOString() };
}

export function subteamOf(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : DEFAULT_SUBTEAM;
}

export function buildHoursSummary(
  rows: Array<{ userId: string; name: string; kind: string; hours: number }>,
): StandupHoursSummary {
  const byKindMap = new Map<string, number>();
  const byUserMap = new Map<string, StandupHoursContributor>();
  let totalHours = 0;

  for (const row of rows) {
    const hours = Number.isFinite(row.hours) ? Math.max(0, row.hours) : 0;
    totalHours += hours;
    byKindMap.set(row.kind, (byKindMap.get(row.kind) ?? 0) + hours);
    const existing = byUserMap.get(row.userId);
    if (existing) existing.hours += hours;
    else byUserMap.set(row.userId, { userId: row.userId, name: row.name, hours });
  }

  const byKind = [...byKindMap.entries()]
    .map(([kind, hours]) => ({ kind, hours: round1(hours) }))
    .sort((a, b) => b.hours - a.hours);

  const topContributors = [...byUserMap.values()]
    .map((c) => ({ ...c, hours: round1(c.hours) }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 10);

  return { totalHours: round1(totalHours), byKind, topContributors };
}

function inWindow(value: string | null, windowStart: string, windowEnd: string): boolean {
  if (!value) return false;
  return value >= windowStart && value < windowEnd;
}

/**
 * Classifies each candidate task row into a single movement event for the digest window.
 * Priority: completed (done_at in window) > blocked (status is blocked and it moved there
 * in-window) > created (created_at in window) > updated (anything else that touched the row).
 */
export function classifyTaskMovement(
  rows: Array<{
    id: string;
    title: string;
    subsystem: string;
    status: string;
    assignee: string | null;
    doneAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>,
  windowStart: string,
  windowEnd: string,
): StandupTaskMovement[] {
  const movement: StandupTaskMovement[] = [];
  for (const row of rows) {
    let event: TaskMovementEvent;
    let occurredAt: string;
    if (inWindow(row.doneAt, windowStart, windowEnd)) {
      event = "completed";
      occurredAt = row.doneAt as string;
    } else if (row.status === "blocked" && inWindow(row.updatedAt, windowStart, windowEnd)) {
      event = "blocked";
      occurredAt = row.updatedAt;
    } else if (inWindow(row.createdAt, windowStart, windowEnd)) {
      event = "created";
      occurredAt = row.createdAt;
    } else {
      event = "updated";
      occurredAt = row.updatedAt;
    }
    movement.push({
      taskId: row.id,
      title: row.title,
      subteam: subteamOf(row.subsystem),
      status: row.status,
      assignee: row.assignee,
      event,
      occurredAt,
    });
  }
  return movement.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export function buildBlockers(
  rows: Array<{
    id: string;
    title: string;
    subsystem: string;
    assignee: string | null;
    blockedReason: string | null;
    createdAt: string;
  }>,
  asOf: Date = new Date(),
): StandupBlocker[] {
  return rows.map((row) => {
    const created = new Date(row.createdAt);
    const ageDays = Number.isNaN(created.getTime())
      ? 0
      : Math.max(0, Math.floor((asOf.getTime() - created.getTime()) / (24 * 60 * 60 * 1000)));
    return {
      taskId: row.id,
      title: row.title,
      subteam: subteamOf(row.subsystem),
      assignee: row.assignee,
      blockedReason: row.blockedReason,
      ageDays,
    };
  });
}

export function buildAttendanceSummary(
  rows: Array<{ id: string; title: string; kind: string; occurredOn: string; attendeeCount: number; creditHours: number }>,
): StandupAttendanceSummary {
  const events: StandupAttendanceEvent[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    kind: row.kind,
    occurredOn: row.occurredOn,
    attendeeCount: Math.max(0, row.attendeeCount),
    creditHours: Math.max(0, row.creditHours),
  }));
  return {
    eventsCount: events.length,
    totalAttendees: events.reduce((sum, e) => sum + e.attendeeCount, 0),
    totalCreditHours: round1(events.reduce((sum, e) => sum + e.creditHours, 0)),
    events,
  };
}

export function buildKnowledgeEdits(
  rows: Array<{ id: string; title: string; updatedByName: string | null; updatedAt: string; created: boolean }>,
): StandupKnowledgeEdit[] {
  return rows.map((row) => ({
    pageId: row.id,
    title: row.title,
    updatedByName: row.updatedByName,
    updatedAt: row.updatedAt,
    created: row.created,
  }));
}

/** Deterministic per-subteam narrative line, grounded only in the counted movement/blockers. */
export function subteamHeadline(input: {
  subteam: string;
  tasksCompleted: number;
  tasksBlocked: number;
  tasksCreated: number;
  openBlockers: number;
}): string {
  const parts: string[] = [];
  if (input.tasksCompleted > 0) parts.push(`${input.tasksCompleted} completed`);
  if (input.tasksBlocked > 0) parts.push(`${input.tasksBlocked} newly blocked`);
  if (input.tasksCreated > 0) parts.push(`${input.tasksCreated} new`);
  if (input.openBlockers > 0) parts.push(`${input.openBlockers} open blocker(s)`);
  if (parts.length === 0) return `${input.subteam}: no logged movement.`;
  return `${input.subteam}: ${parts.join(", ")}.`;
}

export function buildSubteamBriefs(
  movement: StandupTaskMovement[],
  blockers: StandupBlocker[],
): StandupSubteamBrief[] {
  const subteams = new Set<string>([...movement.map((m) => m.subteam), ...blockers.map((b) => b.subteam)]);
  const briefs: StandupSubteamBrief[] = [];
  for (const subteam of [...subteams].sort()) {
    const teamMovement = movement.filter((m) => m.subteam === subteam);
    const openBlockers = blockers.filter((b) => b.subteam === subteam);
    const tasksCompleted = teamMovement.filter((m) => m.event === "completed").length;
    const tasksBlocked = teamMovement.filter((m) => m.event === "blocked").length;
    const tasksCreated = teamMovement.filter((m) => m.event === "created").length;
    briefs.push({
      subteam,
      tasksCompleted,
      tasksBlocked,
      tasksCreated,
      openBlockers,
      headline: subteamHeadline({ subteam, tasksCompleted, tasksBlocked, tasksCreated, openBlockers: openBlockers.length }),
    });
  }
  return briefs;
}

/** Deterministic whole-team narrative composed from the already-computed summary pieces. */
export function overallHeadline(
  input: Pick<StandupDigestSummary, "digestDate" | "hours" | "taskMovement" | "blockers" | "attendance" | "knowledgeEdits">,
): string {
  const completed = input.taskMovement.filter((m) => m.event === "completed").length;
  const blocked = input.taskMovement.filter((m) => m.event === "blocked").length;
  const segments = [
    `${input.digestDate}:`,
    `${input.hours.totalHours}h logged`,
    `${completed} task(s) completed`,
    `${blocked} newly blocked`,
    `${input.blockers.length} open blocker(s)`,
    `${input.attendance.totalAttendees} attendee(s) across ${input.attendance.eventsCount} event(s)`,
    `${input.knowledgeEdits.length} wiki edit(s)`,
  ];
  return segments.join(" · ");
}
