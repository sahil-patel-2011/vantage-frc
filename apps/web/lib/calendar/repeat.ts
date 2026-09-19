/**
 * "Practice every Tuesday and Thursday until bag day."
 *
 * A build season is mostly the same evening over and over, and the calendar
 * could only be told about one evening at a time. Forty practices meant forty
 * trips through the form, which is why most teams' Vantage calendars had the
 * competitions on them and none of the practice they were preparing for.
 *
 * ## Why this expands into real entries rather than storing a rule
 *
 * A stored recurrence rule is the textbook answer and the wrong one here. The
 * thing a team does most often to a practice schedule is break it: this
 * Thursday is cancelled for a snow day, that Tuesday moves to the machine
 * shop, the one before the competition runs late. A rule makes every one of
 * those an exception to be modelled, and exceptions to recurrence rules are
 * where calendar software goes to die.
 *
 * Expanding at creation gives forty ordinary entries that anybody can edit,
 * move or delete one at a time, with no rule to keep in sync — and nothing
 * else in this feature has to know recurrence exists.
 *
 * The cost is honest and worth naming: changing "every Tuesday" afterwards
 * means editing the Tuesdays. For a season-long practice schedule that is a
 * trade worth making; for something that genuinely repeats forever it would
 * not be.
 *
 * Date maths is UTC-only, for the reasons written at the top of `month-grid.ts`.
 */

import { parseDay } from "./month-grid";

const DAY_MS = 86_400_000;

/** 0 = Sunday, matching `Date.getUTCDay` and the month grid's columns. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_LABELS: readonly string[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type RepeatRule = {
  /** Which days it lands on. Empty means it does not repeat. */
  weekdays: readonly Weekday[];
  /** Last date the series may reach, inclusive. `YYYY-MM-DD`. */
  until: string;
  /** 1 = every week, 2 = every other week. */
  everyWeeks?: number;
};

/**
 * A season of three practices a week is about 150 entries; a typo in the year
 * is tens of thousands. The cap is generous enough that nobody meets it by
 * accident and small enough that meeting it cannot hurt.
 */
export const MAX_OCCURRENCES = 200;

export type RepeatExpansion = {
  dates: string[];
  /** True when the cap stopped it early, so the UI can say so. */
  truncated: boolean;
};

function formatDay(stamp: number): string {
  return new Date(stamp).toISOString().slice(0, 10);
}

/**
 * Every date this rule lands on, starting at `startsOn`.
 *
 * The start date is **not** automatically included. A team picking "every
 * Tuesday and Thursday" from a Monday means the Tuesday, not the Monday — the
 * day they happened to be filling the form in is not part of the schedule.
 * With no weekdays chosen the answer is just the start date, which is how "do
 * not repeat" is expressed.
 */
export function expandRepeat(startsOn: string, rule: RepeatRule): RepeatExpansion {
  const start = parseDay(startsOn);
  if (start === null) return { dates: [], truncated: false };
  if (!rule.weekdays.length) return { dates: [startsOn], truncated: false };

  const until = parseDay(rule.until);
  // An end before the start is not an empty series — it is somebody who has
  // not finished filling the form in. One entry, on the day they picked.
  if (until === null || until < start) return { dates: [startsOn], truncated: false };

  const everyWeeks = Number.isFinite(rule.everyWeeks) && (rule.everyWeeks ?? 1) >= 1
    ? Math.floor(rule.everyWeeks ?? 1)
    : 1;
  const wanted = new Set(rule.weekdays);

  // The week the series starts in, so "every other week" counts from there
  // rather than from an arbitrary epoch.
  const startWeek = Math.floor((start - weekStart(start)) / DAY_MS) >= 0 ? weekStart(start) : start;

  const dates: string[] = [];
  let truncated = false;
  for (let stamp = start; stamp <= until; stamp += DAY_MS) {
    const day = new Date(stamp).getUTCDay() as Weekday;
    if (!wanted.has(day)) continue;
    if (everyWeeks > 1) {
      const weeksIn = Math.round((weekStart(stamp) - startWeek) / (7 * DAY_MS));
      if (weeksIn % everyWeeks !== 0) continue;
    }
    if (dates.length >= MAX_OCCURRENCES) {
      truncated = true;
      break;
    }
    dates.push(formatDay(stamp));
  }

  // A rule that matches nothing in range still has to produce the day the
  // person picked, or pressing Add appears to do nothing.
  if (dates.length === 0) return { dates: [startsOn], truncated: false };
  return { dates, truncated };
}

/** Midnight UTC on the Sunday of this timestamp's week. */
function weekStart(stamp: number): number {
  return stamp - new Date(stamp).getUTCDay() * DAY_MS;
}

/** "Tue and Thu until 1 March" — what the form is about to create, in words. */
export function describeRepeat(rule: RepeatRule, count: number): string {
  if (!rule.weekdays.length || count <= 1) return "Once";
  const days = [...rule.weekdays]
    .sort((a, b) => a - b)
    .map((day) => WEEKDAY_LABELS[day] ?? "")
    .filter(Boolean);
  const list =
    days.length === 1
      ? days[0]
      : `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;
  const cadence = (rule.everyWeeks ?? 1) > 1 ? ` every ${rule.everyWeeks} weeks` : "";
  return `${count} entries — ${list}${cadence}`;
}
