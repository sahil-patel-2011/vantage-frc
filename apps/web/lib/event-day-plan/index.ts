// Pure helpers for the event-day stress planner — no I/O, unit-testable in isolation.

export * from "./types";
import type {
  EventDayPlanBlock,
  EventDayPlanConflict,
  EventDayPlanHourSlot,
  EventDayPlanKind,
  EventDayPlanSummary,
} from "./types";

export const EVENT_DAY_PLAN_KINDS: EventDayPlanKind[] = [
  "qual_match",
  "battery_charge",
  "scout_shift",
  "pit_repair",
  "logistics",
  "other",
];

export function eventDayPlanKindLabel(kind: EventDayPlanKind): string {
  const labels: Record<EventDayPlanKind, string> = {
    qual_match: "Qual match",
    battery_charge: "Battery charge",
    scout_shift: "Scout shift",
    pit_repair: "Pit repair window",
    logistics: "Logistics",
    other: "Other",
  };
  return labels[kind];
}

export function eventDayPlanStatusLabel(status: EventDayPlanBlock["status"]): string {
  const labels: Record<EventDayPlanBlock["status"], string> = {
    planned: "Planned",
    in_progress: "In progress",
    done: "Done",
    cancelled: "Cancelled",
  };
  return labels[status];
}

/** Ascending by start time, then end time. */
export function sortBlocksByStart(blocks: EventDayPlanBlock[]): EventDayPlanBlock[] {
  return [...blocks].sort(
    (a, b) => a.startAt.localeCompare(b.startAt) || a.endAt.localeCompare(b.endAt),
  );
}

function overlaps(a: EventDayPlanBlock, b: EventDayPlanBlock): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

function normalizeToken(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

/**
 * Detect scheduling conflicts among logged blocks: overlapping time windows assigned to the
 * same person, or overlapping windows sharing the same location. Cancelled blocks never
 * conflict — they represent a plan that was withdrawn.
 */
export function detectConflicts(blocks: EventDayPlanBlock[]): EventDayPlanConflict[] {
  const active = blocks.filter((b) => b.status !== "cancelled");
  const conflicts: EventDayPlanConflict[] = [];
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i];
      const b = active[j];
      if (!a || !b) continue;
      if (!overlaps(a, b)) continue;

      const assigneeA = normalizeToken(a.assignedTo);
      const assigneeB = normalizeToken(b.assignedTo);
      if (assigneeA && assigneeB && assigneeA === assigneeB) {
        conflicts.push({
          id: `${a.id}:${b.id}:assignee`,
          reason: "assignee_overlap",
          blockAId: a.id,
          blockBId: b.id,
          detail: `${a.assignedTo} is double-booked: "${a.title}" overlaps "${b.title}".`,
        });
        continue;
      }

      const locationA = normalizeToken(a.location);
      const locationB = normalizeToken(b.location);
      if (locationA && locationB && locationA === locationB) {
        conflicts.push({
          id: `${a.id}:${b.id}:location`,
          reason: "location_overlap",
          blockAId: a.id,
          blockBId: b.id,
          detail: `"${a.title}" and "${b.title}" both need ${a.location} at the same time.`,
        });
      }
    }
  }
  return conflicts;
}

/** Bucket blocks into the local hour(s) they touch for a given plan date, 0-23. */
export function groupBlocksByHour(blocks: EventDayPlanBlock[]): EventDayPlanHourSlot[] {
  const buckets = new Map<number, EventDayPlanBlock[]>();
  for (const block of blocks) {
    const start = new Date(block.startAt);
    const end = new Date(block.endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    let hour = start.getHours();
    const endHour = end.getHours() + (end.getMinutes() > 0 || end.getSeconds() > 0 ? 1 : 0);
    const lastHour = Math.max(hour, Math.min(23, endHour === 0 ? 23 : endHour - 1));
    while (hour <= lastHour && hour <= 23) {
      const bucket = buckets.get(hour) ?? [];
      bucket.push(block);
      buckets.set(hour, bucket);
      hour += 1;
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, hourBlocks]) => ({ hour, blocks: sortBlocksByStart(hourBlocks) }));
}

export function summarizeEventDayPlan(
  blocks: EventDayPlanBlock[],
  conflicts: EventDayPlanConflict[],
): EventDayPlanSummary {
  const kindMap = new Map<EventDayPlanKind, number>();
  let unassignedCount = 0;
  for (const block of blocks) {
    kindMap.set(block.kind, (kindMap.get(block.kind) ?? 0) + 1);
    if (!normalizeToken(block.assignedTo)) unassignedCount += 1;
  }
  const byKind = EVENT_DAY_PLAN_KINDS.filter((kind) => kindMap.has(kind)).map((kind) => ({
    kind,
    count: kindMap.get(kind) ?? 0,
  }));
  return {
    totalBlocks: blocks.length,
    byKind,
    conflictCount: conflicts.length,
    unassignedCount,
  };
}
