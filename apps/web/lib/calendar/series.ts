/**
 * Series planning for the team calendar — the pure half of recurrence.
 *
 * `recurrence.ts` answers "when does this rule fire". This module answers the
 * questions the calendar route actually asks:
 *
 *   - given the stored rows (series masters, detached overrides) and their
 *     exceptions, what occurrences fall inside the window the UI is showing?
 *   - when a mentor edits one meeting and picks *this and following*, what do
 *     the two resulting rules look like?
 *
 * Both are where recurrence bugs hide, so both live here as pure functions with
 * no DB, no `Date.now()`, and no framework.
 */

import {
  expandOccurrences,
  formatRRule,
  localDateOf,
  MAX_COUNT,
  normalizeTimeZone,
  occurrenceId,
  parseOccurrenceId,
  parseRRule,
  RecurrenceError,
  recurrenceEndDate,
  type ExceptionAction,
  type RecurrenceRule,
} from "./recurrence";

export { parseOccurrenceId, occurrenceId };

/** The columns the calendar route reads for every stored event row. */
export type SeriesRow = {
  id: string;
  startsAt: string;
  endsAt: string | null;
  /** Canonical RRULE text; non-null only on a series master. */
  rrule: string | null;
  /** Denormalized inclusive end date (YYYY-MM-DD) or null. */
  recurrenceEnd: string | null;
  /** Master id. Equals `id` on a master, the master's id on a detached row. */
  seriesId: string | null;
  recurrenceTimezone: string | null;
};

export type StoredException = {
  seriesId: string;
  /** ISO instant of the original occurrence. */
  occurrenceDate: string;
  action: ExceptionAction;
  detachedEventId: string | null;
};

/** One materialized-for-display occurrence of a series master. */
export type SeriesOccurrence = {
  /** Composite id (`<master>#<original ISO>`), or the master's uuid at DTSTART. */
  id: string;
  masterId: string;
  /** Original occurrence instant — the identity used for exceptions. */
  occurrenceStart: string;
  startsAt: string;
  endsAt: string | null;
  /** True for every occurrence after the first, which reuses the master row's id. */
  virtual: boolean;
};

export type ExpandWindow = {
  /** ISO instant, inclusive. */
  windowStart: string;
  /** ISO instant, exclusive. */
  windowEnd: string;
  /** Per-series ceiling; the window already bounds an unbounded rule. */
  maxPerSeries?: number;
};

/**
 * Recurrence fields the calendar API adds to every event it returns. Additive,
 * so a client that does not know about recurrence still renders the list.
 */
export type RecurrenceEventFields = {
  /** Canonical RRULE of the series this row belongs to (null for one-offs). */
  rrule?: string | null;
  /** Denormalized inclusive end date (YYYY-MM-DD). */
  recurrenceEnd?: string | null;
  /** Master row id — set on masters, occurrences, and detached overrides. */
  seriesId?: string | null;
  /** IANA zone the wall-clock time is anchored to. */
  recurrenceTimezone?: string | null;
  /** Original occurrence instant; the identity used when editing one meeting. */
  occurrenceStart?: string | null;
  /** True when this entry was expanded from a rule rather than stored directly. */
  isOccurrence?: boolean;
  /** "Every Tuesday and Thursday until Feb 20", ready to show under the title. */
  recurrenceSummary?: string | null;
};

export function isSeriesMaster(row: SeriesRow): boolean {
  return typeof row.rrule === "string" && row.rrule.trim().length > 0;
}

export function isDetachedOccurrence(row: SeriesRow): boolean {
  return !isSeriesMaster(row) && row.seriesId != null && row.seriesId !== row.id;
}

/**
 * Expand one master into the occurrences visible in the window.
 *
 * Skipped, moved, and edited occurrences are all removed: a skip means no
 * meeting, and a move/edit is already present in the row set as its own detached
 * row. An unparseable rule yields the single DTSTART occurrence rather than
 * throwing, so one bad row never blanks a team's calendar.
 */
export function expandSeriesRow(
  row: SeriesRow,
  exceptions: StoredException[],
  window: ExpandWindow,
): SeriesOccurrence[] {
  if (!isSeriesMaster(row)) return [];
  const timeZone = normalizeTimeZone(row.recurrenceTimezone);
  const startMs = new Date(row.startsAt).getTime();
  if (Number.isNaN(startMs)) return [];
  const endMs = row.endsAt ? new Date(row.endsAt).getTime() : Number.NaN;
  const durationMs = Number.isNaN(endMs) ? null : Math.max(0, endMs - startMs);

  let occurrences;
  try {
    occurrences = expandOccurrences({
      rrule: row.rrule!,
      start: row.startsAt,
      durationMs,
      timeZone,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      recurrenceEnd: row.recurrenceEnd,
      exceptions: exceptions.map((exception) => ({
        occurrenceDate: exception.occurrenceDate,
        action: exception.action,
      })),
      maxOccurrences: window.maxPerSeries,
    });
  } catch {
    // A rule we cannot read must not take the whole calendar down with it.
    const inWindow =
      startMs >= new Date(window.windowStart).getTime() &&
      startMs < new Date(window.windowEnd).getTime();
    return inWindow
      ? [
          {
            id: row.id,
            masterId: row.id,
            occurrenceStart: new Date(startMs).toISOString(),
            startsAt: new Date(startMs).toISOString(),
            endsAt: row.endsAt,
            virtual: false,
          },
        ]
      : [];
  }

  const firstIso = new Date(startMs).toISOString();
  return occurrences.map((occurrence) => {
    const isFirst = occurrence.startsAt === firstIso;
    return {
      // The first occurrence keeps the real row id so RSVPs, attendance links,
      // and duty rows that already point at this event keep resolving.
      id: isFirst ? row.id : occurrenceId(row.id, occurrence.startsAt),
      masterId: row.id,
      occurrenceStart: occurrence.startsAt,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      virtual: !isFirst,
    };
  });
}

/**
 * Expand every master in `rows`, returning occurrences keyed by master id.
 * Rows that are not masters are ignored — the caller keeps those as-is.
 */
export function expandSeriesRows(
  rows: SeriesRow[],
  exceptions: StoredException[],
  window: ExpandWindow,
): Map<string, SeriesOccurrence[]> {
  const bySeries = new Map<string, StoredException[]>();
  for (const exception of exceptions) {
    const list = bySeries.get(exception.seriesId) ?? [];
    list.push(exception);
    bySeries.set(exception.seriesId, list);
  }
  const out = new Map<string, SeriesOccurrence[]>();
  for (const row of rows) {
    if (!isSeriesMaster(row)) continue;
    out.set(row.id, expandSeriesRow(row, bySeries.get(row.id) ?? [], window));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * "This and following"
 * ------------------------------------------------------------------ */

export type SeriesSplit = {
  /**
   * Rule for the occurrences before the split, or null when the split lands on
   * the very first occurrence (the caller then replaces the master outright).
   */
  head: { rrule: string; recurrenceEnd: string | null } | null;
  /** Rule the new series carries from the split occurrence onward. */
  tail: { rrule: string; recurrenceEnd: string | null };
};

/**
 * Split a series at `splitStart` so "this and following" can rewrite the tail
 * without touching past meetings.
 *
 * - a `COUNT` rule keeps its total: head takes the occurrences already past, the
 *   tail takes the rest;
 * - an `UNTIL` or unbounded rule gets a head `UNTIL` one second before the split
 *   and hands the original ending to the tail.
 */
export function splitSeriesRule(input: {
  rrule: string;
  /** DTSTART of the existing master. */
  start: string;
  /** Original instant of the occurrence the edit starts at. */
  splitStart: string;
  timeZone?: string | null;
  recurrenceEnd?: string | null;
}): SeriesSplit {
  const rule = parseRRule(input.rrule);
  const timeZone = normalizeTimeZone(input.timeZone);
  const startMs = new Date(input.start).getTime();
  const splitMs = new Date(input.splitStart).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(splitMs)) {
    throw new RecurrenceError("Cannot split a series without valid dates.");
  }
  if (splitMs <= startMs) {
    // Editing from the first occurrence onward is just editing the series.
    return {
      head: null,
      tail: {
        rrule: formatRRule(rule),
        recurrenceEnd: recurrenceEndDate(formatRRule(rule), { timeZone }),
      },
    };
  }

  if (rule.count != null) {
    // Occurrences strictly before the split consume that many counts. The
    // expander is window-bounded, so an absurdly long head is clamped — COUNT
    // is capped at MAX_COUNT precisely so this stays exact in practice.
    const before = expandOccurrences({
      rrule: rule,
      start: input.start,
      timeZone,
      windowStart: input.start,
      windowEnd: new Date(splitMs).toISOString(),
      maxOccurrences: MAX_COUNT,
    });
    const headCount = before.length > 0 ? before[before.length - 1]!.index + 1 : 0;
    const tailCount = Math.max(1, Math.min(MAX_COUNT, rule.count - headCount));
    const headRule: RecurrenceRule = { ...rule, count: headCount };
    const tailRule: RecurrenceRule = { ...rule, count: tailCount };
    return {
      head: headCount > 0 ? { rrule: formatRRule(headRule), recurrenceEnd: null } : null,
      tail: { rrule: formatRRule(tailRule), recurrenceEnd: null },
    };
  }

  const headUntilIso = new Date(splitMs - 1000).toISOString();
  const headRule: RecurrenceRule = { ...rule, until: headUntilIso };
  const headText = formatRRule(headRule);
  const tailText = formatRRule(rule);
  return {
    head: {
      rrule: headText,
      recurrenceEnd: localDateOf(headUntilIso, timeZone),
    },
    tail: {
      rrule: tailText,
      recurrenceEnd:
        recurrenceEndDate(tailText, { timeZone }) ?? (input.recurrenceEnd ?? null),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Request parsing (kept out of the route so it can be unit tested)
 * ------------------------------------------------------------------ */

export const OCCURRENCE_SCOPES = ["this", "following", "all"] as const;
export type OccurrenceScope = (typeof OCCURRENCE_SCOPES)[number];

export type RepeatInput = {
  /** Canonical RRULE text, or null for "does not repeat". */
  rrule: string | null;
  timeZone: string;
  /** Denormalized inclusive end date for the column, or null. */
  recurrenceEnd: string | null;
};

/**
 * Read the optional repeat fields off a create/update body.
 *
 * Deliberately strict: an unsupported rule is rejected with the message from
 * `parseRRule` instead of being stored and quietly mis-expanded later.
 */
export function parseRepeatInput(body: Record<string, unknown>): RepeatInput {
  const timeZone = normalizeTimeZone(
    typeof body.timeZone === "string" ? body.timeZone : undefined,
  );
  const raw = body.rrule;
  if (raw == null || raw === "" || raw === false) {
    return { rrule: null, timeZone, recurrenceEnd: null };
  }
  if (typeof raw !== "string") throw new RecurrenceError("Repeat rule must be text.");
  // parseRRule throws RecurrenceError with a human message for anything outside
  // the supported subset; formatRRule then canonicalizes what we store.
  const canonical = formatRRule(parseRRule(raw));
  return {
    rrule: canonical,
    timeZone,
    recurrenceEnd: recurrenceEndDate(canonical, { timeZone }),
  };
}

export function parseOccurrenceScope(value: unknown): OccurrenceScope {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if ((OCCURRENCE_SCOPES as readonly string[]).includes(text)) return text as OccurrenceScope;
  return "this";
}

export type OccurrenceRef = {
  /** The stored row this reference resolves against. */
  rowId: string;
  /** Original occurrence instant when the reference is a virtual occurrence. */
  occurrenceStart: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve an id from the client: either a plain row uuid or the composite
 * `<master>#<original ISO>` form used for virtual occurrences.
 */
export function parseOccurrenceRef(value: unknown): OccurrenceRef {
  if (typeof value !== "string" || value.trim() === "") {
    throw new RecurrenceError("Event id is required.");
  }
  const text = value.trim();
  if (UUID_RE.test(text)) return { rowId: text, occurrenceStart: null };
  const parsed = parseOccurrenceId(text);
  if (!parsed) throw new RecurrenceError("Event id is not valid.");
  return { rowId: parsed.masterId, occurrenceStart: parsed.occurrenceDate };
}
