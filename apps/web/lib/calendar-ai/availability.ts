/**
 * Evidence for scheduling: which slots this team actually turns up to.
 *
 * The whole value of scheduling inside Vantage rather than in Google Calendar
 * is that Vantage already knows who is on which subteam and who actually shows
 * up. So a proposal can carry a reason — "9 of 12 mechanical said yes to the
 * last four Tuesdays" — instead of a guess.
 *
 * The rule that shapes this file: NEVER invent availability. Two rows of RSVP
 * history is not a pattern, and saying "most people are free Tuesday" when
 * nobody has RSVP'd to anything is exactly the kind of confident-sounding
 * fabrication CLAUDE.md forbids. Every function here returns evidence or
 * returns nothing, and the caller must be able to tell which.
 *
 * Pure functions over rows — no database, no network, no clock. The caller
 * passes `now`, so this is deterministic and testable.
 */

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** A past event with how many people said yes. */
export type PastEvent = {
  startsAt: string;
  endsAt: string | null;
  kind: string;
  subteamId: string | null;
  going: number;
  /** Members eligible to respond at the time — the denominator. */
  invited: number;
};

/** A recorded attendance session: how many people were actually there. */
export type PastAttendance = {
  occurredOn: string;
  kind: string;
  attended: number;
};

export type SlotEvidence = {
  weekday: Weekday;
  weekdayName: string;
  /** Local hour the session started, 0-23. */
  hour: number;
  /** How many past sessions this slot is drawn from. */
  samples: number;
  /** Mean people who said yes, or actually attended. Null when unknown. */
  meanTurnout: number | null;
  /** Mean share of invited members who said yes, 0-1. Null when unknown. */
  meanShare: number | null;
  /** One sentence a human can check, or null when there is nothing to say. */
  evidence: string | null;
};

/**
 * Below this many past sessions a slot is not a pattern, it is an anecdote.
 * Two Tuesdays is not evidence that Tuesdays work.
 */
export const MIN_SAMPLES_FOR_PATTERN = 3;

function hourOf(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours();
}

function weekdayOf(iso: string): Weekday | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getDay() as Weekday;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Turn past events and attendance into per-slot evidence.
 *
 * A slot is (weekday, hour). Slots with fewer than MIN_SAMPLES_FOR_PATTERN
 * sessions are still returned — the caller may want to show them — but their
 * `evidence` is null, which is the signal that they must not be presented as a
 * reason to pick that time.
 */
export function slotEvidence(input: {
  events: PastEvent[];
  attendance?: PastAttendance[];
  /** Restrict to one subteam's events; omit for the whole team. */
  subteamId?: string | null;
}): SlotEvidence[] {
  const events = input.subteamId
    ? input.events.filter((e) => e.subteamId === input.subteamId)
    : input.events;

  const buckets = new Map<string, { weekday: Weekday; hour: number; going: number[]; shares: number[] }>();

  for (const event of events) {
    const weekday = weekdayOf(event.startsAt);
    const hour = hourOf(event.startsAt);
    if (weekday == null || hour == null) continue;
    const key = `${weekday}:${hour}`;
    const bucket = buckets.get(key) ?? { weekday, hour, going: [], shares: [] };
    bucket.going.push(event.going);
    // Share is only meaningful when we know who was invited.
    if (event.invited > 0) bucket.shares.push(event.going / event.invited);
    buckets.set(key, bucket);
  }

  // Attendance sessions have a date but no time of day, so they can only
  // strengthen a weekday, never an hour. They are folded in as turnout samples
  // on the weekday's existing slots rather than inventing an hour for them.
  const attendanceByWeekday = new Map<Weekday, number[]>();
  for (const session of input.attendance ?? []) {
    const weekday = weekdayOf(`${session.occurredOn}T12:00:00`);
    if (weekday == null) continue;
    const list = attendanceByWeekday.get(weekday) ?? [];
    list.push(session.attended);
    attendanceByWeekday.set(weekday, list);
  }

  const out: SlotEvidence[] = [];
  for (const bucket of buckets.values()) {
    const extra = attendanceByWeekday.get(bucket.weekday) ?? [];
    const turnouts = [...bucket.going, ...extra];
    const samples = bucket.going.length;
    const meanTurnout = turnouts.length ? round1(turnouts.reduce((a, b) => a + b, 0) / turnouts.length) : null;
    const meanShare = bucket.shares.length
      ? bucket.shares.reduce((a, b) => a + b, 0) / bucket.shares.length
      : null;

    out.push({
      weekday: bucket.weekday,
      weekdayName: WEEKDAY_NAMES[bucket.weekday],
      hour: bucket.hour,
      samples,
      meanTurnout,
      meanShare: meanShare == null ? null : Math.round(meanShare * 100) / 100,
      evidence:
        samples >= MIN_SAMPLES_FOR_PATTERN && meanTurnout != null
          ? `${WEEKDAY_NAMES[bucket.weekday]} at ${formatHour(bucket.hour)}: ${meanTurnout} people on average across ${samples} past sessions${
              meanShare != null ? ` (${Math.round(meanShare * 100)}% of those invited)` : ""
            }.`
          : null,
    });
  }

  // Best evidence first: most turnout, then most samples. Slots with no
  // evidence sink to the bottom rather than being dropped.
  out.sort((a, b) => {
    if ((a.evidence == null) !== (b.evidence == null)) return a.evidence == null ? 1 : -1;
    return (b.meanTurnout ?? -1) - (a.meanTurnout ?? -1) || b.samples - a.samples;
  });
  return out;
}

export type BusyWindow = { startsAt: string; endsAt: string | null; title: string };

/** True when [start,end) overlaps an existing event. Touching edges do not clash. */
export function conflictsWith(
  candidateStart: Date,
  candidateEnd: Date,
  busy: BusyWindow[],
): BusyWindow | null {
  for (const window of busy) {
    const start = new Date(window.startsAt);
    if (Number.isNaN(start.getTime())) continue;
    // An event with no end is treated as one hour, which is the shortest thing
    // worth protecting; assuming zero length would let us book straight over it.
    const end = window.endsAt ? new Date(window.endsAt) : new Date(start.getTime() + 60 * 60 * 1000);
    if (candidateStart < end && start < candidateEnd) return window;
  }
  return null;
}

export type Proposal = {
  startsAt: string;
  endsAt: string;
  weekdayName: string;
  /** Why this slot, in one checkable sentence. Null when we have no evidence. */
  reason: string | null;
  /** True when nothing in the team's calendar overlaps it. */
  clear: boolean;
  conflictTitle?: string;
};

/**
 * Concrete, dated proposals from slot evidence.
 *
 * Returns an empty array rather than a guess when there is no evidence and no
 * caller-supplied preference — the API then tells the user plainly that there
 * is no attendance history yet, which is more useful than three invented times.
 */
export function proposeSlots(input: {
  now: Date;
  evidence: SlotEvidence[];
  busy: BusyWindow[];
  durationMinutes: number;
  /** How many days ahead to look. */
  horizonDays: number;
  /** Cap on returned proposals. */
  limit?: number;
  /** Weekday/hour the requester explicitly asked for, when they did. */
  preferred?: { weekday?: Weekday; hour?: number };
}): Proposal[] {
  const limit = input.limit ?? 3;
  const usable = input.evidence.filter((s) => s.evidence != null);

  // Nothing to go on and nothing asked for: say so upstream instead of guessing.
  const candidates: Array<{ weekday: Weekday; hour: number; reason: string | null }> =
    usable.length > 0
      ? usable.map((s) => ({ weekday: s.weekday, hour: s.hour, reason: s.evidence }))
      : input.preferred?.weekday != null && input.preferred.hour != null
        ? [{ weekday: input.preferred.weekday, hour: input.preferred.hour, reason: null }]
        : [];

  if (candidates.length === 0) return [];

  const out: Proposal[] = [];
  for (let dayOffset = 1; dayOffset <= input.horizonDays && out.length < limit; dayOffset += 1) {
    const day = new Date(input.now);
    day.setDate(day.getDate() + dayOffset);
    for (const candidate of candidates) {
      if (out.length >= limit) break;
      if (day.getDay() !== candidate.weekday) continue;
      const start = new Date(day);
      start.setHours(candidate.hour, 0, 0, 0);
      if (start <= input.now) continue;
      const end = new Date(start.getTime() + input.durationMinutes * 60 * 1000);
      const clash = conflictsWith(start, end, input.busy);
      out.push({
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        weekdayName: WEEKDAY_NAMES[start.getDay() as Weekday],
        reason: candidate.reason,
        clear: clash == null,
        ...(clash ? { conflictTitle: clash.title } : {}),
      });
    }
  }
  // A clear slot beats a clashing one at the same quality.
  out.sort((a, b) => Number(b.clear) - Number(a.clear));
  return out.slice(0, limit);
}

function formatHour(hour: number): string {
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${suffix}`;
}

export { formatHour };
