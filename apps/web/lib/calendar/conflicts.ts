/**
 * "That's on top of something else."
 *
 * The team calendar would let you put a mechanical build night at 6pm on a
 * Tuesday that already had a whole-team meeting at 6pm, save it without a
 * word, and leave fifteen students to find out on Tuesday. Nothing was broken
 * — both events are legitimate rows — and that is exactly why nobody caught
 * it. A calendar that accepts everything silently is not neutral; it is
 * quietly wrong about the one thing it exists to tell you.
 *
 * So this answers a narrower question than "do these two rows overlap in
 * time": **are the same people expected in two places at once?**
 *
 *   - A whole-team event conflicts with everything, because everyone is in it.
 *   - A subteam event conflicts with its own subteam and with whole-team
 *     events.
 *   - Two *different* subteams at the same hour are not a conflict. Mechanical
 *     in the shop while programming is in the lab is a normal Tuesday, and
 *     flagging it would teach people to ignore the warning — which costs more
 *     than never having written it.
 *
 * It warns; it never blocks. Teams double-book on purpose (an optional outreach
 * shift during practice) and a calendar that refuses to record what is actually
 * happening just moves the schedule into a group chat.
 */

/** The little a conflict check needs — far less than the calendar stores. */
export type ConflictEvent = {
  id: string;
  title: string;
  /** ISO instant. */
  startsAt: string;
  /** ISO instant, or null for an entry with no stated end. */
  endsAt: string | null;
  /** null means the whole team. */
  subteamId: string | null;
  subteamName: string | null;
};

/** What the person is about to save. `id` is set when editing an existing one. */
export type ProposedEvent = {
  id?: string | null;
  startsAt: string;
  endsAt: string | null;
  subteamId: string | null;
};

export type CalendarConflict = {
  event: ConflictEvent;
  /**
   * Why these two collect the same people:
   *  - "whole-team" — one of the two is a whole-team event.
   *  - "same-subteam" — both belong to the same subteam.
   */
  reason: "whole-team" | "same-subteam";
};

/** Cap the list so a badly-seeded month cannot render a hundred warnings. */
export const MAX_REPORTED_CONFLICTS = 4;

/**
 * How long an entry with no stated end occupies.
 *
 * An hour: the shortest thing worth protecting. Treating it as zero-length
 * would let anything be booked straight over it, and guessing a whole evening
 * would invent data.
 *
 * This constant exists because the answer has to be the same everywhere. The
 * AI scheduler's `conflictsWith` reached this conclusion first, for proposing
 * slots; the create form needed the same question answered for warning about
 * one. Two modules quietly disagreeing about whether 6pm is free is precisely
 * the bug a user would hit — "Find a time" refusing an hour the form calls
 * clear — so there is one rule and both import it.
 */
export const OPEN_ENDED_MS = 60 * 60 * 1000;

/**
 * The span an event actually occupies, applying the open-ended rule above.
 * Returns null when the start is unparseable, or when a stored row's end
 * precedes its own start.
 */
export function occupiedRange(
  startsAt: string,
  endsAt: string | null,
): { start: number; end: number } | null {
  const start = instant(startsAt);
  if (start == null) return null;
  const stated = instant(endsAt);
  if (stated == null) return { start, end: start + OPEN_ENDED_MS };
  if (stated <= start) return null;
  return { start, end: stated };
}

function instant(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Do these two spans overlap?
 *
 * Touching is not overlapping: a 6–9 build night and a 9–12 drive practice are
 * back-to-back, which is a normal evening, not a clash.
 */
function rangesOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Are the same people expected at both? */
function sharedAudience(
  proposed: string | null,
  existing: string | null,
): CalendarConflict["reason"] | null {
  if (proposed == null || existing == null) return "whole-team";
  return proposed === existing ? "same-subteam" : null;
}

/**
 * Everything already on the calendar that wants the same people at the same
 * time, soonest first.
 *
 * Editing an event does not conflict with itself — without that, opening an
 * event and changing its title would report the event you are editing.
 */
export function findConflicts(
  proposed: ProposedEvent,
  existing: readonly ConflictEvent[],
): CalendarConflict[] {
  // An end before its start is the user mid-keystroke in a datetime field, not
  // a schedule. Nothing useful to say about it yet.
  const span = occupiedRange(proposed.startsAt, proposed.endsAt);
  if (!span) return [];

  const found: CalendarConflict[] = [];
  for (const event of existing) {
    if (proposed.id && event.id === proposed.id) continue;
    const reason = sharedAudience(proposed.subteamId, event.subteamId);
    if (!reason) continue;
    const other = occupiedRange(event.startsAt, event.endsAt);
    if (!other) continue;
    if (!rangesOverlap(span, other)) continue;
    found.push({ event, reason });
  }

  found.sort((a, b) => (instant(a.event.startsAt) ?? 0) - (instant(b.event.startsAt) ?? 0));
  return found.slice(0, MAX_REPORTED_CONFLICTS);
}

/**
 * The sentence to put under the time fields.
 *
 * Names the thing it clashes with, because "1 conflict" sends the person
 * hunting through the month to find out what. Returns null when there is
 * nothing to say, so the caller renders nothing rather than an empty box.
 */
export function describeConflicts(conflicts: readonly CalendarConflict[]): string | null {
  if (conflicts.length === 0) return null;
  const [first] = conflicts;
  const who = first!.reason === "whole-team" ? "the whole team" : first!.event.subteamName ?? "this subteam";
  const head = `Overlaps ${first!.event.title}, which ${who} is already expected at`;
  if (conflicts.length === 1) return `${head}.`;
  const rest = conflicts.length - 1;
  return `${head} — and ${rest} other${rest === 1 ? "" : "s"} at the same time.`;
}
