/**
 * Pure standup digest. Every number is counted from the hours and work items
 * the caller already loaded. A day with nothing logged has no headline.
 */

import type { WorkItem } from "../work-items/types";
import type {
  StandupBlocker,
  StandupDigest,
  StandupHoursContributor,
  StandupHoursSummary,
  StandupMovement,
  StandupMovementEvent,
} from "./types";

const MS_DAY = 24 * 60 * 60 * 1000;

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Yesterday (UTC calendar day) relative to `now`, as YYYY-MM-DD. */
export function defaultDigestDate(now: Date = new Date()): string {
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return yesterday.toISOString().slice(0, 10);
}

export function isDigestDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** [00:00:00, next-day 00:00:00) UTC window for an ISO calendar date. */
export function windowForDate(digestDate: string): { windowStart: string; windowEnd: string } {
  const start = new Date(`${digestDate}T00:00:00.000Z`);
  const end = new Date(start.getTime() + MS_DAY);
  return { windowStart: start.toISOString(), windowEnd: end.toISOString() };
}

export function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function inWindow(value: string | null | undefined, windowStart: string, windowEnd: string): boolean {
  const ms = timestampMs(value);
  if (ms == null) return false;
  const start = Date.parse(windowStart);
  const end = Date.parse(windowEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return ms >= start && ms < end;
}

export function buildHoursSummary(
  rows: Array<{ userId: string; name: string; kind: string; hours: number }>,
): StandupHoursSummary {
  const byKindMap = new Map<string, number>();
  const byUserMap = new Map<string, StandupHoursContributor>();
  let totalHours = 0;

  for (const row of rows) {
    const hours = Number.isFinite(row.hours) ? Math.max(0, row.hours) : 0;
    if (hours <= 0) continue;
    totalHours += hours;
    byKindMap.set(row.kind, (byKindMap.get(row.kind) ?? 0) + hours);
    const existing = byUserMap.get(row.userId);
    if (existing) existing.hours += hours;
    else byUserMap.set(row.userId, { userId: row.userId, name: row.name.trim() || "Member", hours });
  }

  return {
    totalHours: round1(totalHours),
    byKind: [...byKindMap.entries()]
      .map(([kind, hours]) => ({ kind, hours: round1(hours) }))
      .sort((a, b) => b.hours - a.hours || a.kind.localeCompare(b.kind)),
    contributors: [...byUserMap.values()]
      .map((entry) => ({ ...entry, hours: round1(entry.hours) }))
      .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name)),
  };
}

function ownerNames(item: WorkItem): string[] {
  return item.owners.map((owner) => owner.name).filter((name) => name.length > 0);
}

/**
 * Work that actually moved in the digest window. Priority: completed (completedAt
 * in window) > blocked (status is blocked and created in window) > created.
 * Standing blocked items without an in-window timestamp are not movement — they
 * belong on the open-blocker list, not as invented "newly blocked today" rows.
 */
export function classifyMovement(
  items: readonly WorkItem[],
  windowStart: string,
  windowEnd: string,
): StandupMovement[] {
  const movement: StandupMovement[] = [];
  for (const item of items) {
    const completed = inWindow(item.completedAt, windowStart, windowEnd);
    const created = inWindow(item.createdAt, windowStart, windowEnd);
    if (!completed && !created) continue;

    let event: StandupMovementEvent;
    let occurredAt: string;
    if (completed && item.completedAt) {
      event = "completed";
      occurredAt = item.completedAt;
    } else if (item.status === "blocked" && item.createdAt) {
      event = "blocked";
      occurredAt = item.createdAt;
    } else if (item.createdAt) {
      event = "created";
      occurredAt = item.createdAt;
    } else {
      continue;
    }

    movement.push({
      id: item.id,
      source: item.source,
      title: item.title,
      grouping: item.grouping,
      status: item.status,
      owners: ownerNames(item),
      event,
      occurredAt,
      href: item.href,
    });
  }
  return movement.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.title.localeCompare(b.title));
}

export function standingBlockers(items: readonly WorkItem[], asOf: Date = new Date()): StandupBlocker[] {
  const asOfMs = asOf.getTime();
  return items
    .filter((item) => item.status === "blocked")
    .map((item) => {
      const created = timestampMs(item.createdAt);
      const ageDays =
        created == null ? 0 : Math.max(0, Math.floor((asOfMs - created) / MS_DAY));
      return {
        id: item.id,
        source: item.source,
        title: item.title,
        grouping: item.grouping,
        owners: ownerNames(item),
        href: item.href,
        ageDays,
      };
    })
    .sort((a, b) => b.ageDays - a.ageDays || a.title.localeCompare(b.title));
}

/** True only when this date has closed hours or in-window task movement. */
export function digestHasWork(input: {
  hours: StandupHoursSummary;
  movement: readonly StandupMovement[];
}): boolean {
  return input.hours.totalHours > 0 || input.movement.length > 0;
}

/**
 * Deterministic one-liner from counted rows. Returns null when there is nothing
 * to say — callers must show empty, not a "0h · 0 completed" placeholder.
 */
export function digestHeadline(input: {
  digestDate: string;
  hours: StandupHoursSummary;
  movement: readonly StandupMovement[];
}): string | null {
  if (!digestHasWork(input)) return null;
  const completed = input.movement.filter((row) => row.event === "completed").length;
  const created = input.movement.filter((row) => row.event === "created").length;
  const blocked = input.movement.filter((row) => row.event === "blocked").length;
  const parts: string[] = [];
  if (input.hours.totalHours > 0) parts.push(`${input.hours.totalHours}h logged`);
  if (completed > 0) parts.push(`${completed} completed`);
  if (created > 0) parts.push(`${created} opened`);
  if (blocked > 0) parts.push(`${blocked} blocked`);
  return `${input.digestDate}: ${parts.join(" · ")}`;
}

export function compileDigest(input: {
  digestDate: string;
  items: readonly WorkItem[];
  hourRows: Array<{ userId: string; name: string; kind: string; hours: number }>;
  asOf?: Date;
}): StandupDigest {
  const { windowStart, windowEnd } = windowForDate(input.digestDate);
  const hours = buildHoursSummary(input.hourRows);
  const movement = classifyMovement(input.items, windowStart, windowEnd);
  return {
    digestDate: input.digestDate,
    windowStart,
    windowEnd,
    hours,
    movement,
    blockers: standingBlockers(input.items, input.asOf),
    headline: digestHeadline({ digestDate: input.digestDate, hours, movement }),
  };
}
