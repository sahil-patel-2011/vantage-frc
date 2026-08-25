import { expandOccurrences, type OccurrenceException } from "../calendar/recurrence";

/**
 * Parent-view payload handling. Pure: takes the jsonb from get_parent_view
 * (migration 0471), expands recurring series into concrete occurrences, and
 * classifies the page state — setup_required | empty | ready. Never invents
 * events; an org with nothing scheduled is an honest "empty".
 */

export type ParentViewRawEvent = {
  id: string;
  title: string;
  kind: string;
  location: string;
  startsAt: string;
  endsAt: string | null;
  rrule: string | null;
  recurrenceEnd: string | null;
  timeZone: string | null;
  seriesId: string | null;
  exceptions: OccurrenceException[] | null;
  studentRsvp: string | null;
};

export type ParentViewPayload = {
  orgName: string;
  teamNumber: number | null;
  studentLabel: string;
  studentLinked: boolean;
  events: ParentViewRawEvent[];
};

export type ParentViewEvent = {
  id: string;
  title: string;
  kind: string;
  location: string;
  startsAt: string;
  endsAt: string | null;
  /** The linked student's OWN response only; null when unset or unlinked. */
  studentRsvp: "going" | "maybe" | "no" | null;
};

export type ParentViewState =
  | { status: "setup_required"; message: string }
  | { status: "empty"; orgName: string; teamNumber: number | null; studentLabel: string; message: string }
  | {
      status: "ready";
      orgName: string;
      teamNumber: number | null;
      studentLabel: string;
      events: ParentViewEvent[];
    };

const WINDOW_DAYS = 30;
const MAX_EVENTS = 60;

function rsvpOf(value: string | null | undefined): ParentViewEvent["studentRsvp"] {
  return value === "going" || value === "maybe" || value === "no" ? value : null;
}

/**
 * Expand raw rows into concrete upcoming occurrences inside [now, now+30d).
 * Series masters expand via their RRULE (exceptions suppressed — moved/edited
 * occurrences arrive as their own detached rows); an invalid rule degrades to
 * the master's own start rather than crashing the parent's page.
 */
export function expandParentViewEvents(
  raw: ParentViewRawEvent[],
  now: Date = new Date(),
  windowDays: number = WINDOW_DAYS,
): ParentViewEvent[] {
  const windowStart = now.toISOString();
  const windowEnd = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000).toISOString();
  const out: ParentViewEvent[] = [];

  for (const event of raw) {
    if (!event?.id || !event.title) continue;
    if (event.rrule) {
      let expanded: boolean;
      try {
        const startMs = new Date(event.startsAt).getTime();
        const endMs = event.endsAt ? new Date(event.endsAt).getTime() : Number.NaN;
        const durationMs =
          Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
            ? endMs - startMs
            : null;
        const occurrences = expandOccurrences({
          rrule: event.rrule,
          start: event.startsAt,
          durationMs,
          timeZone: event.timeZone ?? "UTC",
          windowStart,
          windowEnd,
          exceptions: event.exceptions ?? [],
          recurrenceEnd: event.recurrenceEnd,
        });
        for (const occurrence of occurrences) {
          out.push({
            id: `${event.id}#${occurrence.startsAt}`,
            title: event.title,
            kind: event.kind,
            location: event.location ?? "",
            startsAt: occurrence.startsAt,
            endsAt: occurrence.endsAt,
            // RSVPs attach to concrete rows; expanded occurrences have none.
            studentRsvp: null,
          });
        }
        expanded = true;
      } catch {
        expanded = false;
      }
      if (expanded) continue;
    }
    // Concrete row (single event or detached occurrence) — window-filter it.
    if (event.startsAt >= windowStart && event.startsAt < windowEnd) {
      out.push({
        id: event.id,
        title: event.title,
        kind: event.kind,
        location: event.location ?? "",
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        studentRsvp: rsvpOf(event.studentRsvp),
      });
    }
  }

  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, MAX_EVENTS);
}

/**
 * Classify a resolved payload into a page state. `"unavailable"` covers a
 * database that cannot be reached — the parent sees an honest outage message,
 * never a hard failure or invented data. A null payload (unknown token) is a
 * 404 handled by the route, not here.
 */
export function classifyParentView(
  payload: ParentViewPayload | "unavailable",
  now: Date = new Date(),
): ParentViewState {
  if (payload === "unavailable") {
    return {
      status: "setup_required",
      message: "This link is not available right now. Please try again later or ask the team for a fresh link.",
    };
  }
  const events = expandParentViewEvents(payload.events ?? [], now);
  if (events.length === 0) {
    return {
      status: "empty",
      orgName: payload.orgName,
      teamNumber: payload.teamNumber,
      studentLabel: payload.studentLabel,
      message: "Nothing is scheduled in the next 30 days.",
    };
  }
  return {
    status: "ready",
    orgName: payload.orgName,
    teamNumber: payload.teamNumber,
    studentLabel: payload.studentLabel,
    events,
  };
}
