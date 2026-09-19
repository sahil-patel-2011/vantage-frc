/**
 * "How many build nights are left before the competition?"
 *
 * This is the question an FRC team asks in January, and the answer decides
 * whether the swerve rewrite happens. Until now the calendar could only be
 * counted by eye — squint at the grid, count the Tuesdays, forget the week
 * everyone is away for finals, and be wrong by three sessions in the
 * optimistic direction.
 *
 * Everything here is counted from entries the team actually put on the
 * calendar. Nothing is modelled, estimated or averaged: if a team has not
 * scheduled its build nights, the honest answer is that we do not know how
 * many are left, and that is what this returns. A confident wrong number here
 * is worse than no number, because a team that believes it has twenty nights
 * left will commit to a rebuild it cannot finish.
 */

import type { Milestone, MilestoneKind } from "../season-calendar";
import type { OverlayMeeting } from "./meetings-overlay";

/** The kinds that count as "the thing you are building for". */
const TARGET_KINDS: readonly MilestoneKind[] = ["event", "deadline"];

/**
 * Season-calendar entries that are themselves shop time.
 *
 * A team that writes its practice schedule on the season calendar — which is
 * what the repeat control there is for — was getting nothing from this,
 * because it only counted meetings from the team calendar. Two features of
 * ours, disagreeing about whether the team had scheduled anything.
 *
 * These are whole-day entries with no start or end, so they add a session and
 * never an hour. That is exactly the case `sessionsWithoutEnd` already exists
 * to be honest about, so the sentence stays truthful without a new concept:
 * "14 sessions — 24 hours from the 8 with a time".
 */
const SESSION_KINDS: readonly MilestoneKind[] = ["practice", "build", "meeting"];

export type ShopTimeLeft = {
  /** The milestone being counted down to. */
  targetTitle: string;
  targetDate: string;
  targetKind: MilestoneKind;
  /** Whole days from today to the target, never negative. */
  daysUntil: number;
  /** Meetings scheduled between now and then. */
  sessions: number;
  /** Hours from the sessions that have a start and an end. Rounded to a half hour. */
  hours: number;
  /**
   * Sessions that contributed nothing to `hours` — a meeting with no end
   * time, or a whole-day season entry that has no times at all. Surfaced
   * rather than hidden: a total that quietly omits four sessions is a number
   * a team would plan against and be wrong.
   */
  sessionsWithoutEnd: number;
};

function startOfLocalDay(stamp: Date): number {
  return new Date(stamp.getFullYear(), stamp.getMonth(), stamp.getDate()).getTime();
}

function parseLocalDay(dateISO: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!match) return null;
  const [, year, month, day] = match;
  const stamp = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(stamp.getTime()) ? null : stamp.getTime();
}

/**
 * What is left before the next competition or deadline, or `null` when the
 * calendar cannot say.
 *
 * `null` for two different honest reasons — nothing to count down to, or
 * nothing scheduled to count — and the caller says which. Both are ordinary
 * states for a team in October, not errors.
 */
export function shopTimeLeft(
  milestones: readonly Milestone[],
  meetings: readonly OverlayMeeting[],
  now: Date = new Date(),
): ShopTimeLeft | null {
  const todayStart = startOfLocalDay(now);

  let target: Milestone | null = null;
  let targetStart = Number.POSITIVE_INFINITY;
  for (const milestone of milestones) {
    if (!TARGET_KINDS.includes(milestone.kind)) continue;
    // A competition that has already started is not something to prepare for.
    if (milestone.done) continue;
    const start = parseLocalDay(milestone.startsOn);
    if (start === null || start < todayStart) continue;
    if (start < targetStart) {
      target = milestone;
      targetStart = start;
    }
  }
  if (!target) return null;

  let sessions = 0;
  let withoutEnd = 0;
  let millis = 0;

  for (const milestone of milestones) {
    if (!SESSION_KINDS.includes(milestone.kind)) continue;
    if (milestone.done) continue;
    const day = parseLocalDay(milestone.startsOn);
    // A whole day counts while any of it is still ahead, so today's practice
    // is not dropped at one minute past midnight.
    if (day === null || day < todayStart || day >= targetStart) continue;
    sessions += 1;
    withoutEnd += 1;
  }

  for (const meeting of meetings) {
    const start = new Date(meeting.startsAt);
    if (Number.isNaN(start.getTime())) continue;
    // From this moment, not from midnight: a build night that finished an hour
    // ago is not time you still have.
    if (start.getTime() < now.getTime()) continue;
    // The day of the competition is not shop time, so the window is exclusive
    // of the target day itself.
    if (startOfLocalDay(start) >= targetStart) continue;
    sessions += 1;
    const end = meeting.endsAt ? new Date(meeting.endsAt) : null;
    if (!end || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
      withoutEnd += 1;
      continue;
    }
    millis += end.getTime() - start.getTime();
  }

  if (sessions === 0) return null;

  return {
    targetTitle: target.title,
    targetDate: target.startsOn,
    targetKind: target.kind,
    daysUntil: Math.max(0, Math.round((targetStart - todayStart) / 86_400_000)),
    sessions,
    hours: Math.round((millis / 3_600_000) * 2) / 2,
    sessionsWithoutEnd: withoutEnd,
  };
}

/**
 * "14 build nights — 42 hours — before Week 1 Regional."
 *
 * The hours clause is dropped rather than shown as zero when nothing has an
 * end time, and qualified when only some do. A team reading "0 hours" beside
 * fourteen sessions would reasonably conclude the feature is broken; a team
 * reading "42 hours" when four sessions were not counted would plan against a
 * number that is quietly too small.
 */
export function describeShopTime(left: ShopTimeLeft): string {
  const sessions = `${left.sessions} ${left.sessions === 1 ? "session" : "sessions"}`;
  const counted = left.sessions - left.sessionsWithoutEnd;
  if (counted === 0) return sessions;
  const hours = `${left.hours} ${left.hours === 1 ? "hour" : "hours"}`;
  if (left.sessionsWithoutEnd > 0) {
    return `${sessions} — ${hours} from the ${counted} with a time`;
  }
  return `${sessions} — ${hours}`;
}
