/**
 * "What have we got left this week?"
 *
 * The most-asked calendar question, and the one the season page answered
 * worst. The hero said what the *next milestone* is — which in October is a
 * competition eleven weeks away — and the grid showed a whole month, so
 * finding out whether anything was on before Saturday meant reading a square
 * at a time.
 *
 * This is the rest of the current week: today onwards, to the end of the week
 * the grid is drawing. Not "the next seven days", deliberately — the week the
 * grid shows and the week this describes have to be the same week, or one of
 * them is lying about what it means by "this week".
 *
 * Milestones and meetings both, because a student asking this does not care
 * which of our two calendars a thing was written on.
 */

import { localToday, parseDay, weekOf, type WeekStart } from "./month-grid";
import { groupMeetingsByDay, type OverlayMeeting } from "./meetings-overlay";
import { milestonesInMonth } from "../season-calendar";
import type { Milestone } from "../season-calendar";

export type WeekEntry = {
  /** `YYYY-MM-DD`. */
  date: string;
  title: string;
  /** "6–9 PM" for a meeting, empty for a whole-day milestone. */
  timeLabel: string;
  kind: "milestone" | "meeting";
};

export type RestOfWeek = {
  /** Days remaining in this week, including today. */
  days: string[];
  entries: WeekEntry[];
};

/**
 * Everything still to come this week, earliest first.
 *
 * Empty `entries` is an ordinary answer — a quiet week in October — and the
 * caller should say so rather than showing an empty box or, worse, reaching
 * further out to find something to put in it.
 */
export function restOfWeek(
  milestones: readonly Milestone[],
  meetings: readonly OverlayMeeting[],
  options: { today?: string; weekStartsOn?: WeekStart } = {},
): RestOfWeek {
  const today = options.today ?? localToday();
  const week = weekOf(today, options.weekStartsOn ?? 0);
  const todayStamp = parseDay(today);
  if (todayStamp === null || week.length === 0) return { days: [], entries: [] };

  const days = week.filter((day) => {
    const stamp = parseDay(day);
    return stamp !== null && stamp >= todayStamp;
  });
  if (days.length === 0) return { days: [], entries: [] };

  const wanted = new Set(days);
  const byDay = groupMeetingsByDay(meetings);
  const entries: WeekEntry[] = [];

  // A week can straddle two months, so both are asked. `milestonesInMonth`
  // already includes a span that merely passes through a month, which is what
  // makes a competition running Friday to Sunday show on the Friday.
  const months = new Set(days.map((day) => day.slice(0, 7)));
  const seen = new Set<string>();
  for (const month of months) {
    for (const milestone of milestonesInMonth(milestones, month)) {
      if (milestone.done) continue;
      const day = dayInWeek(milestone, wanted);
      if (!day) continue;
      if (seen.has(milestone.id)) continue;
      seen.add(milestone.id);
      entries.push({ date: day, title: milestone.title, timeLabel: "", kind: "milestone" });
    }
  }

  for (const day of days) {
    for (const meeting of byDay.get(day) ?? []) {
      entries.push({
        date: day,
        title: meeting.title,
        timeLabel: meeting.timeLabel,
        kind: "meeting",
      });
    }
  }

  /*
    Date, then kind, and then nothing — the sort is stable, and meetings were
    pushed in the order `groupMeetingsByDay` put them, which is by their real
    start time.

    Comparing `timeLabel` here instead was wrong in a way that looked right:
    it is a label, so "7–9 PM" sorts before "8–9 AM" and the evening came out
    above the morning.
  */
  entries.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      // A whole-day milestone sits above the evening's meetings: it is the
      // shape of the day, and they are what happens inside it.
      (a.kind === b.kind ? 0 : a.kind === "milestone" ? -1 : 1),
  );
  return { days, entries };
}

/**
 * The first day of `wanted` this milestone covers, or null.
 *
 * A competition that started on Monday is still on on Thursday, so a span is
 * reported on the first day of the remaining week it touches rather than only
 * on the day it began.
 */
function dayInWeek(milestone: Milestone, wanted: ReadonlySet<string>): string | null {
  const start = parseDay(milestone.startsOn);
  if (start === null) return null;
  const end = milestone.endsOn ? parseDay(milestone.endsOn) : null;
  if (end === null || end < start) return wanted.has(milestone.startsOn) ? milestone.startsOn : null;
  for (let stamp = start; stamp <= end; stamp += 86_400_000) {
    const day = new Date(stamp).toISOString().slice(0, 10);
    if (wanted.has(day)) return day;
  }
  return null;
}

/** "Thu" — the column this entry sits under on the grid. */
export function weekdayLabel(dateISO: string): string {
  const stamp = parseDay(dateISO);
  if (stamp === null) return "";
  return new Date(stamp).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
}
