/**
 * The month grid a calendar actually needs — weeks of days, with each day
 * knowing what is on it.
 *
 * Calendar has never had a calendar. It is a list of milestones grouped under
 * month headings, which answers "what is coming up" and cannot answer "what
 * does the week of the 14th look like", "is that scrimmage the same weekend as
 * the deadline", or "how many free evenings are left before bag day" — the
 * questions a month view exists for.
 *
 * ## Why this is string math
 *
 * Milestones are whole days: `startsOn` and `endsOn` are `YYYY-MM-DD` with no
 * time and no zone. Parsing those with `new Date("2027-02-01")` gives midnight
 * **UTC**, which in any negative-offset zone is the previous evening — so a
 * team in Los Angeles building a February grid would see February 1st land in
 * the January 31st cell, and every event shift a day. Parsing them with
 * `new Date("2027-02-01T00:00:00")` gives midnight local, which fixes that and
 * then breaks differently: adding 24-hour steps across a spring-forward
 * boundary skips a day.
 *
 * So dates never become local `Date`s here. They are parsed to UTC, stepped in
 * whole UTC days — which have no DST — and formatted straight back. "Today" is
 * the one value that must be local, and it is passed in already resolved.
 */

import type { Milestone } from "../season-calendar";

/** Where a day sits inside a milestone that covers more than one day. */
export type EntrySpan = "single" | "start" | "middle" | "end";

export type GridEntry = {
  milestone: Milestone;
  span: EntrySpan;
};

export type GridDay = {
  /** `YYYY-MM-DD`. */
  date: string;
  dayOfMonth: number;
  /** False for the neighbouring days that pad the first and last weeks. */
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  entries: GridEntry[];
};

export type MonthGrid = {
  /** `YYYY-MM`. */
  month: string;
  /** "February 2027". */
  label: string;
  /** Seven days each, always. */
  weeks: GridDay[][];
  /** Column headings, in the same order as the columns. */
  weekdayLabels: string[];
};

const DAY_MS = 86_400_000;
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
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 0 = Sunday (US default, and what FRC calendars use), 1 = Monday. */
export type WeekStart = 0 | 1;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

/** `YYYY-MM-DD` to a UTC timestamp, or null when it is not a date. */
export function parseDay(dateISO: string): number | null {
  const match = DATE_PATTERN.exec(dateISO);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const stamp = Date.UTC(year, month - 1, day);
  // Rejects the 31st of a 30-day month and February 30th, which `Date.UTC`
  // silently rolls forward into the next month.
  const back = new Date(stamp);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) {
    return null;
  }
  return stamp;
}

function formatDay(stamp: number): string {
  return new Date(stamp).toISOString().slice(0, 10);
}

/** The `YYYY-MM` a date belongs to. */
export function monthOf(dateISO: string): string {
  return dateISO.slice(0, 7);
}

/** `YYYY-MM` plus or minus whole months, wrapping the year. */
export function shiftMonth(monthISO: string, delta: number): string {
  const match = MONTH_PATTERN.exec(monthISO);
  if (!match) return monthISO;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1 + delta;
  const shifted = new Date(Date.UTC(year, month, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "February 2027", for a heading. */
export function monthLabel(monthISO: string): string {
  const match = MONTH_PATTERN.exec(monthISO);
  if (!match) return monthISO;
  const index = Number(match[2]) - 1;
  return `${MONTH_NAMES[index] ?? monthISO} ${match[1]}`;
}

/**
 * Today where the person is, as `YYYY-MM-DD`.
 *
 * The one place a local date is correct: which square to ring is a question
 * about the reader's wall clock, not about UTC.
 */
export function localToday(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Every day a milestone covers, inclusive of both ends.
 *
 * An `endsOn` before its `startsOn` is bad data, not a reason to render
 * nothing or to loop forever: the milestone shows on its start day alone.
 * A range longer than a season is clamped for the same reason — one typo in a
 * year should not try to build thirty thousand cells.
 */
const MAX_SPAN_DAYS = 400;

export function milestoneDays(milestone: Milestone): string[] {
  const start = parseDay(milestone.startsOn);
  if (start === null) return [];
  const end = milestone.endsOn ? parseDay(milestone.endsOn) : null;
  if (end === null || end <= start) return [milestone.startsOn];

  const days: string[] = [];
  const span = Math.min(Math.round((end - start) / DAY_MS), MAX_SPAN_DAYS - 1);
  for (let index = 0; index <= span; index += 1) {
    days.push(formatDay(start + index * DAY_MS));
  }
  return days;
}

function spanAt(index: number, total: number): EntrySpan {
  if (total <= 1) return "single";
  if (index === 0) return "start";
  if (index === total - 1) return "end";
  return "middle";
}

/**
 * Build the grid for one month.
 *
 * Always whole weeks, so the columns line up under their headings: the first
 * week is padded back to the week start and the last runs on to the week end.
 * Those padding days are real days with real events on them — they are marked
 * `inMonth: false` so the UI can mute them, not hide what is on them.
 */
export function buildMonthGrid(
  monthISO: string,
  milestones: readonly Milestone[],
  options: { today?: string; weekStartsOn?: WeekStart } = {},
): MonthGrid {
  const match = MONTH_PATTERN.exec(monthISO);
  const safeMonth = match ? monthISO : localToday().slice(0, 7);
  const [yearText, monthText] = safeMonth.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const weekStartsOn: WeekStart = options.weekStartsOn === 1 ? 1 : 0;
  const today = options.today ?? localToday();

  const byDay = new Map<string, GridEntry[]>();
  for (const milestone of milestones) {
    const days = milestoneDays(milestone);
    days.forEach((day, index) => {
      const entries = byDay.get(day) ?? [];
      entries.push({ milestone, span: spanAt(index, days.length) });
      byDay.set(day, entries);
    });
  }

  const firstOfMonth = Date.UTC(year, monthIndex, 1);
  const leading = (new Date(firstOfMonth).getUTCDay() - weekStartsOn + 7) % 7;
  const gridStart = firstOfMonth - leading * DAY_MS;

  // Last day of this month, then run on to the end of its week.
  const lastOfMonth = Date.UTC(year, monthIndex + 1, 0);
  const trailing = (weekStartsOn + 6 - new Date(lastOfMonth).getUTCDay() + 7) % 7;
  const gridEnd = lastOfMonth + trailing * DAY_MS;

  const weeks: GridDay[][] = [];
  let week: GridDay[] = [];
  for (let stamp = gridStart; stamp <= gridEnd; stamp += DAY_MS) {
    const moment = new Date(stamp);
    const date = formatDay(stamp);
    const weekday = moment.getUTCDay();
    week.push({
      date,
      dayOfMonth: moment.getUTCDate(),
      inMonth: moment.getUTCMonth() === monthIndex && moment.getUTCFullYear() === year,
      isToday: date === today,
      isWeekend: weekday === 0 || weekday === 6,
      // Sorted so a day's chips keep one order between renders: the thing that
      // started earliest first, then alphabetically, never by object identity.
      entries: (byDay.get(date) ?? []).slice().sort((a, b) => {
        const byStart = a.milestone.startsOn.localeCompare(b.milestone.startsOn);
        return byStart !== 0 ? byStart : a.milestone.title.localeCompare(b.milestone.title);
      }),
    });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) weeks.push(week);

  return {
    month: safeMonth,
    label: monthLabel(safeMonth),
    weeks,
    weekdayLabels: WEEKDAY_NAMES.slice(weekStartsOn).concat(WEEKDAY_NAMES.slice(0, weekStartsOn)),
  };
}

/**
 * The seven days of the week containing `dateISO`, for the week view.
 */
export function weekOf(dateISO: string, weekStartsOn: WeekStart = 0): string[] {
  const stamp = parseDay(dateISO);
  if (stamp === null) return [];
  const offset = (new Date(stamp).getUTCDay() - weekStartsOn + 7) % 7;
  const start = stamp - offset * DAY_MS;
  return Array.from({ length: 7 }, (_, index) => formatDay(start + index * DAY_MS));
}
