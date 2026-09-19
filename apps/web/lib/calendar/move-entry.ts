/**
 * Moving something to a different day.
 *
 * The scrimmage moves to the following weekend. On this calendar that meant
 * finding the entry in the list below the grid, opening its editor, changing
 * a date field, and — if it ran more than one day — remembering to change the
 * second one by the same amount. Four steps and one of them easy to forget,
 * for the single most ordinary thing anybody does to a calendar.
 *
 * The rules are short enough to state:
 *
 *   - A move preserves duration. Dropping a three-day competition on a Friday
 *     means Friday to Sunday, not a competition that now ends before it
 *     starts. Nothing here can produce an end before its start.
 *   - Dropping an entry where it already is changes nothing, and says so, so
 *     the caller does not write a no-op to the database.
 *
 * Date maths is UTC-only, for the reason written at the top of `month-grid.ts`:
 * a day is a label here, not an instant, and stepping in local hours loses one
 * every time a clock changes.
 */

import type { Milestone, MilestonePatch } from "../season-calendar";
import { parseDay } from "./month-grid";

const DAY_MS = 86_400_000;

function formatDay(stamp: number): string {
  return new Date(stamp).toISOString().slice(0, 10);
}

/**
 * The patch that moves `milestone` so it starts on `toDate`, or `null` when
 * there is nothing to do.
 *
 * `null` for three different reasons, all of them ordinary: the target is not
 * a date, the entry's own dates are not dates, or it is already there.
 */
export function moveToDate(milestone: Milestone, toDate: string): MilestonePatch | null {
  const target = parseDay(toDate);
  const from = parseDay(milestone.startsOn);
  if (target === null || from === null) return null;
  if (target === from) return null;
  return shiftedPatch(milestone, target - from);
}

/**
 * The patch that moves `milestone` by whole days, or `null` when there is
 * nothing to do. Negative moves it earlier.
 */
export function moveByDays(milestone: Milestone, deltaDays: number): MilestonePatch | null {
  if (!Number.isFinite(deltaDays) || Math.trunc(deltaDays) === 0) return null;
  if (parseDay(milestone.startsOn) === null) return null;
  return shiftedPatch(milestone, Math.trunc(deltaDays) * DAY_MS);
}

function shiftedPatch(milestone: Milestone, deltaMs: number): MilestonePatch | null {
  const from = parseDay(milestone.startsOn);
  if (from === null) return null;
  const startsOn = formatDay(from + deltaMs);

  // A span moves whole. An end that will not parse is dropped rather than
  // guessed at: the entry moves, and the bad second date does not travel with
  // it pretending to be a duration.
  const end = milestone.endsOn ? parseDay(milestone.endsOn) : null;
  if (!milestone.endsOn) return { startsOn, endsOn: null };
  if (end === null) return { startsOn, endsOn: null };
  // An end before its start is bad data already. Moving it must not encode
  // that as a negative duration, so the entry lands as a single day.
  if (end < from) return { startsOn, endsOn: null };
  return { startsOn, endsOn: formatDay(end + deltaMs) };
}

/** "Moved to Fri, 12 Mar" — what just happened, for the live region. */
export function describeMove(patch: MilestonePatch): string {
  if (!patch.startsOn) return "Moved";
  const label = new Date(`${patch.startsOn}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `Moved to ${label}`;
}
