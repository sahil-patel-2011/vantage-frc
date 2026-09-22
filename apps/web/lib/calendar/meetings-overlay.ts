/**
 * The team's actual meetings, laid over the season calendar's month grid.
 *
 * Vantage has two calendars and they are not redundant: `/calendar` is the
 * shape of the season — kickoff, competitions, bag day, the twelve dates that
 * do not move — and `/team/calendar` is the fifty meetings a team actually
 * attends. The problem was that the season month grid showed only the first
 * kind, so a student who opened "the calendar" to find out whether there was
 * practice on Thursday saw an empty square and concluded there was not.
 *
 * This is an overlay, not a merge. The meetings are read-only here, and
 * pressing one goes to the calendar that owns it. Two reasons:
 *
 *   - They are timed, and this grid has no time axis. A 6pm build night and a
 *     whole-day competition are different objects and pretending otherwise
 *     would mean inventing a start time for every milestone.
 *   - Editing in two places means two places to get the recurrence exceptions
 *     wrong. One owner, one editor.
 *
 * Grouping is by **local** day, deliberately. A meeting is stored as an
 * instant; which square it belongs in is a question about the person looking
 * at the grid, not about the database. A 9pm Tuesday build night is Tuesday
 * for everyone standing in the shop, and the grid they are reading is drawn in
 * their own timezone.
 */

/** A meeting as the season calendar needs it — far less than the team calendar stores. */
export type OverlayMeeting = {
  id: string;
  title: string;
  /** ISO instant. */
  startsAt: string;
  /** ISO instant, or null for an open-ended entry. */
  endsAt: string | null;
  subteamName: string | null;
  subteamColor: string | null;
};

export type DayMeeting = OverlayMeeting & {
  /** "6 PM" or "6–9 PM", short enough for a grid cell. */
  timeLabel: string;
};

/**
 * More than this on one day is a scheduling mistake or a runaway rule, and
 * either way the cell cannot show them. The grid's own "N more" covers the
 * honest overflow; this only stops one bad series from costing a whole render.
 */
export const MAX_MEETINGS_PER_DAY = 12;

/** `YYYY-MM-DD` for an instant, in the runtime's local zone. */
function localDay(stamp: Date): string {
  const year = stamp.getFullYear();
  const month = `${stamp.getMonth() + 1}`.padStart(2, "0");
  const day = `${stamp.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hourMinute(stamp: Date): { hour: number; minute: number } {
  return { hour: stamp.getHours(), minute: stamp.getMinutes() };
}

/**
 * "6 PM", "6:30 PM", "6–9 PM".
 *
 * On the hour drops the ":00" because a grid chip has room for the title or
 * the time and usually not both, and "6 PM" loses nothing. The end time is
 * shown only when it lands on the same day — "6 PM – 12 AM" across midnight
 * reads as an error rather than as a late night.
 */
export function meetingTimeLabel(startsAt: string, endsAt: string | null): string {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return "";
  const startText = clockText(start);
  if (!endsAt) return startText;
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return startText;
  if (localDay(end) !== localDay(start)) return startText;
  if (end.getTime() <= start.getTime()) return startText;
  return `${clockText(start, meridiemMatches(start, end))}–${clockText(end)}`;
}

/** True when both times share a meridiem, so the first one can drop it: "6–9 PM". */
function meridiemMatches(a: Date, b: Date): boolean {
  return a.getHours() < 12 === b.getHours() < 12;
}

function clockText(stamp: Date, dropMeridiem = false): string {
  const { hour, minute } = hourMinute(stamp);
  const meridiem = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  const body = minute === 0 ? `${twelve}` : `${twelve}:${`${minute}`.padStart(2, "0")}`;
  return dropMeridiem ? body : `${body} ${meridiem}`;
}

/**
 * Meetings grouped into the squares they belong in, earliest first.
 *
 * A meeting is placed on the day it starts and nowhere else. A build night
 * that runs to half past midnight is Tuesday's build night, not a Tuesday
 * entry and a Wednesday one — and the multi-day spans this grid does draw are
 * for milestones, which are whole-day by construction.
 */
export function groupMeetingsByDay(
  meetings: readonly OverlayMeeting[],
): Map<string, DayMeeting[]> {
  const byDay = new Map<string, DayMeeting[]>();
  for (const meeting of meetings) {
    const start = new Date(meeting.startsAt);
    if (Number.isNaN(start.getTime())) continue;
    const day = localDay(start);
    const list = byDay.get(day) ?? [];
    if (list.length >= MAX_MEETINGS_PER_DAY) continue;
    list.push({ ...meeting, timeLabel: meetingTimeLabel(meeting.startsAt, meeting.endsAt) });
    byDay.set(day, list);
  }
  for (const list of byDay.values()) {
    // Earliest first, then by title so two meetings at 6pm keep a stable order
    // rather than whichever the database happened to return first.
    list.sort(
      (a, b) =>
        new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() ||
        a.title.localeCompare(b.title),
    );
  }
  return byDay;
}
