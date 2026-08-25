// Pure date scheduling for the pre-event countdown — no I/O, no fake clocks.
// All dates are ISO "YYYY-MM-DD" strings compared in UTC so results are
// identical regardless of the server's timezone.

import type { ReadinessStatus } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function toUtcMs(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime();
}

const DAY_MS = 86_400_000;

/** date + deltaDays, as an ISO date. */
export function shiftIsoDate(date: string, deltaDays: number): string {
  return new Date(toUtcMs(date) + deltaDays * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` until `to` (positive when `to` is later). */
export function diffDays(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

/** Open items due within this many days count as at-risk. */
export const AT_RISK_WINDOW_DAYS = 2;

export type ReadinessFlag = "done" | "overdue" | "at_risk" | "scheduled" | "no_date";

export type ScheduleItemInput = {
  id: string;
  dueOn: string | null;
  daysBefore: number | null;
  status: ReadinessStatus;
};

export type ScheduledItem<T extends ScheduleItemInput> = T & {
  /** dueOn when set, else event_start_date minus daysBefore, else null (never defaulted). */
  resolvedDueOn: string | null;
  /** Days between the resolved due date and event start (positive = before the event). */
  daysBeforeEvent: number | null;
  /** Days from `today` until the resolved due date (negative = past due). */
  daysUntilDue: number | null;
  flag: ReadinessFlag;
};

export type CountdownGroup<T extends ScheduleItemInput> = {
  dueOn: string;
  daysBeforeEvent: number;
  items: ScheduledItem<T>[];
};

export type ReadinessCountdown<T extends ScheduleItemInput> = {
  /** Dated groups in chronological order. Items without any date are NOT here. */
  groups: CountdownGroup<T>[];
  /** Items with neither due_on nor days_before — listed honestly, never dated. */
  undated: ScheduledItem<T>[];
  overdueCount: number;
  atRiskCount: number;
  doneCount: number;
  openCount: number;
};

export function resolveDueDates<T extends ScheduleItemInput>(input: {
  eventStartDate: string;
  items: T[];
  today: string;
}): ReadinessCountdown<T> {
  const { eventStartDate, today } = input;

  const scheduled: ScheduledItem<T>[] = input.items.map((item) => {
    const resolvedDueOn = isIsoDate(item.dueOn)
      ? item.dueOn
      : item.daysBefore != null && Number.isInteger(item.daysBefore) && item.daysBefore >= 0
        ? shiftIsoDate(eventStartDate, -item.daysBefore)
        : null;
    const daysUntilDue = resolvedDueOn ? diffDays(today, resolvedDueOn) : null;
    const daysBeforeEvent = resolvedDueOn ? diffDays(resolvedDueOn, eventStartDate) : null;
    const closed = item.status === "done" || item.status === "not_applicable";
    const flag: ReadinessFlag = closed
      ? "done"
      : resolvedDueOn == null || daysUntilDue == null
        ? "no_date"
        : daysUntilDue < 0
          ? "overdue"
          : daysUntilDue <= AT_RISK_WINDOW_DAYS
            ? "at_risk"
            : "scheduled";
    return { ...item, resolvedDueOn, daysBeforeEvent, daysUntilDue, flag };
  });

  const dated = scheduled.filter((item) => item.resolvedDueOn != null);
  const undated = scheduled.filter((item) => item.resolvedDueOn == null);

  const byDate = new Map<string, ScheduledItem<T>[]>();
  for (const item of dated) {
    const key = item.resolvedDueOn as string;
    const bucket = byDate.get(key) ?? [];
    bucket.push(item);
    byDate.set(key, bucket);
  }
  const groups = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dueOn, items]) => ({
      dueOn,
      daysBeforeEvent: diffDays(dueOn, eventStartDate),
      items,
    }));

  const doneCount = scheduled.filter((i) => i.flag === "done").length;
  return {
    groups,
    undated,
    overdueCount: scheduled.filter((i) => i.flag === "overdue").length,
    atRiskCount: scheduled.filter((i) => i.flag === "at_risk").length,
    doneCount,
    openCount: scheduled.length - doneCount,
  };
}
