/**
 * Recurring calendar events — pure RFC 5545 subset.
 *
 * A build season is "Tuesday and Thursday 6-9pm plus Saturday 10-4" for fourteen
 * weeks. Without recurrence a mentor hand-creates ~50 rows, so this module is the
 * engine behind `subteam_calendar_events.rrule` (migration 0456).
 *
 * ## Supported subset (everything else is rejected with a clear message)
 *
 * - `FREQ=DAILY | WEEKLY | MONTHLY`
 * - `INTERVAL=<n>` (1..52)
 * - `BYDAY=` two-letter weekdays; for MONTHLY a single ordinal day (`3TU`, `-1FR`)
 * - `COUNT=<n>` (1..500) or `UNTIL=<YYYYMMDD | YYYYMMDDTHHMMSSZ>` — never both
 * - `WKST=MO` (the default; any other value is rejected rather than mishandled)
 *
 * Rejecting is deliberate: silently ignoring `BYSETPOS` would put the wrong
 * meetings on a team's calendar, which is worse than an error message.
 *
 * ## Timezone / DST
 *
 * Recurrence is **wall-clock** in the series' IANA timezone: a 6pm Tuesday
 * meeting stays 6pm local across the November DST change, which means the UTC
 * instant shifts by an hour. All arithmetic runs on local Y/M/D + H:M:S parts and
 * converts back to an instant through `Intl.DateTimeFormat`, so no `Date`
 * local-time methods (which use the *server's* zone) are used anywhere here.
 *
 * Framework-free, dependency-free, and deterministic — no wall-clock reads.
 */

export const FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Sunday-indexed (JS `getUTCDay`) order for weekday math. */
const WEEKDAY_BY_INDEX: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

export type RecurrenceRule = {
  freq: Frequency;
  /** 1..52. */
  interval: number;
  /** WEEKLY/DAILY: plain weekdays. MONTHLY: at most one ordinal entry. */
  byDay: Weekday[];
  /** MONTHLY only: 1..5 or -1 paired with a single `byDay` entry. */
  byDayOrdinal: number | null;
  /** Total occurrences counted from DTSTART (exceptions still consume a count). */
  count: number | null;
  /** Inclusive cutoff as an ISO instant. Never set together with `count`. */
  until: string | null;
};

export const MAX_INTERVAL = 52;
export const MAX_COUNT = 500;
/** Hard ceiling so an unbounded series can never generate without bound. */
export const MAX_OCCURRENCES = 400;

export class RecurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecurrenceError";
  }
}

/* ------------------------------------------------------------------ *
 * Timezone helpers (Intl-based, no dependency on the server's zone)
 * ------------------------------------------------------------------ */

export type LocalParts = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    throw new RecurrenceError(`Unknown timezone "${timeZone}".`);
  }
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/** True when the runtime accepts this IANA zone. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Normalize a client-supplied zone, falling back to UTC rather than throwing. */
export function normalizeTimeZone(timeZone: string | null | undefined): string {
  const value = (timeZone ?? "").trim();
  if (!value) return "UTC";
  if (value.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(value)) return "UTC";
  return isValidTimeZone(value) ? value : "UTC";
}

/** Wall-clock parts of an instant in `timeZone`. */
export function toLocalParts(instantMs: number, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const get = (type: string) => {
    const found = parts.find((part) => part.type === type);
    return found ? Number(found.value) : 0;
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Zone offset (ms east of UTC) in effect at an instant. */
export function timeZoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = toLocalParts(instantMs, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Wall-clock parts in `timeZone` → instant. Two-pass so the offset used is the
 * one actually in effect at the resulting instant (this is what keeps 6pm at 6pm
 * across a DST change). Times inside a spring-forward gap resolve forward.
 */
export function localPartsToInstant(parts: LocalParts, timeZone: string): number {
  const guess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const firstOffset = timeZoneOffsetMs(guess, timeZone);
  let instant = guess - firstOffset;
  const secondOffset = timeZoneOffsetMs(instant, timeZone);
  if (secondOffset !== firstOffset) instant = guess - secondOffset;
  return instant;
}

/** Sunday-indexed weekday of a local calendar date. */
function weekdayOfLocalDate(year: number, month: number, day: number): Weekday {
  const index = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return WEEKDAY_BY_INDEX[index]!;
}

/** Days since epoch for a local calendar date — safe for month arithmetic. */
function dayNumber(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function fromDayNumber(dayNum: number): { year: number; month: number; day: number } {
  const date = new Date(dayNum * 86400000);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/* ------------------------------------------------------------------ *
 * Parsing / formatting
 * ------------------------------------------------------------------ */

const SUPPORTED_PARTS = new Set(["FREQ", "INTERVAL", "BYDAY", "COUNT", "UNTIL", "WKST"]);

function parseUntil(raw: string): string {
  const value = raw.trim().toUpperCase();
  const utcMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (utcMatch) {
    const ms = Date.UTC(
      Number(utcMatch[1]),
      Number(utcMatch[2]) - 1,
      Number(utcMatch[3]),
      Number(utcMatch[4]),
      Number(utcMatch[5]),
      Number(utcMatch[6]),
    );
    if (Number.isNaN(ms)) throw new RecurrenceError(`UNTIL "${raw}" is not a valid date.`);
    return new Date(ms).toISOString();
  }
  const dateMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateMatch) {
    // Date-only UNTIL is inclusive of the whole day.
    const ms = Date.UTC(
      Number(dateMatch[1]),
      Number(dateMatch[2]) - 1,
      Number(dateMatch[3]),
      23,
      59,
      59,
    );
    if (Number.isNaN(ms)) throw new RecurrenceError(`UNTIL "${raw}" is not a valid date.`);
    return new Date(ms).toISOString();
  }
  throw new RecurrenceError(
    `UNTIL "${raw}" must be YYYYMMDD or YYYYMMDDTHHMMSSZ (local floating UNTIL is not supported).`,
  );
}

function parseByDay(raw: string, freq: Frequency): { byDay: Weekday[]; byDayOrdinal: number | null } {
  const tokens = raw
    .split(",")
    .map((token) => token.trim().toUpperCase())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) throw new RecurrenceError("BYDAY is empty.");

  const byDay: Weekday[] = [];
  let ordinal: number | null = null;

  for (const token of tokens) {
    const match = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(token);
    if (!match) throw new RecurrenceError(`BYDAY value "${token}" is not a supported weekday.`);
    const day = match[2] as Weekday;
    const ordinalRaw = match[1];
    if (ordinalRaw != null) {
      if (freq !== "MONTHLY") {
        throw new RecurrenceError(
          `Ordinal BYDAY ("${token}") is only supported with FREQ=MONTHLY.`,
        );
      }
      if (tokens.length > 1) {
        throw new RecurrenceError("Monthly rules support only one ordinal BYDAY value.");
      }
      const value = Number(ordinalRaw);
      if (!Number.isInteger(value) || value === 0 || value > 5 || value < -1) {
        throw new RecurrenceError(`BYDAY ordinal "${ordinalRaw}" must be 1..5 or -1.`);
      }
      ordinal = value;
    } else if (freq === "MONTHLY") {
      throw new RecurrenceError(
        `Monthly BYDAY needs an ordinal (for example 3TU); "${token}" is ambiguous.`,
      );
    }
    if (byDay.includes(day)) continue;
    byDay.push(day);
  }

  // Keep a stable Mon-first order so formatting round-trips.
  if (ordinal == null) {
    byDay.sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
  }
  return { byDay, byDayOrdinal: ordinal };
}

/**
 * Parse an RRULE string (with or without the `RRULE:` prefix).
 * Throws `RecurrenceError` with a human message for anything outside the subset.
 */
export function parseRRule(input: string): RecurrenceRule {
  if (typeof input !== "string") throw new RecurrenceError("Repeat rule must be text.");
  const text = input.trim().replace(/^RRULE:/i, "").trim();
  if (!text) throw new RecurrenceError("Repeat rule is empty.");
  if (text.length > 400) throw new RecurrenceError("Repeat rule is too long.");
  if (/\r|\n/.test(text)) throw new RecurrenceError("Repeat rule must be a single line.");

  const rule: RecurrenceRule = {
    freq: "WEEKLY",
    interval: 1,
    byDay: [],
    byDayOrdinal: null,
    count: null,
    until: null,
  };
  let sawFreq = false;
  const seen = new Set<string>();

  for (const chunk of text.split(";")) {
    const piece = chunk.trim();
    if (!piece) continue;
    const eq = piece.indexOf("=");
    if (eq < 1) throw new RecurrenceError(`Repeat rule part "${piece}" is malformed.`);
    const name = piece.slice(0, eq).trim().toUpperCase();
    const value = piece.slice(eq + 1).trim();
    if (!SUPPORTED_PARTS.has(name)) {
      throw new RecurrenceError(
        `"${name}" is not supported. Vantage supports FREQ, INTERVAL, BYDAY, COUNT, UNTIL.`,
      );
    }
    if (seen.has(name)) throw new RecurrenceError(`"${name}" appears more than once.`);
    seen.add(name);

    switch (name) {
      case "FREQ": {
        const freq = value.toUpperCase();
        if (!(FREQUENCIES as readonly string[]).includes(freq)) {
          throw new RecurrenceError(
            `FREQ=${value} is not supported. Use DAILY, WEEKLY, or MONTHLY.`,
          );
        }
        rule.freq = freq as Frequency;
        sawFreq = true;
        break;
      }
      case "INTERVAL": {
        const interval = Number(value);
        if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) {
          throw new RecurrenceError(`INTERVAL must be a whole number from 1 to ${MAX_INTERVAL}.`);
        }
        rule.interval = interval;
        break;
      }
      case "COUNT": {
        const count = Number(value);
        if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
          throw new RecurrenceError(`COUNT must be a whole number from 1 to ${MAX_COUNT}.`);
        }
        rule.count = count;
        break;
      }
      case "UNTIL":
        rule.until = parseUntil(value);
        break;
      case "WKST":
        if (value.toUpperCase() !== "MO") {
          throw new RecurrenceError("Only WKST=MO (weeks starting Monday) is supported.");
        }
        break;
      default:
        break;
    }
  }

  if (!sawFreq) throw new RecurrenceError("Repeat rule needs FREQ.");
  if (seen.has("BYDAY")) {
    const byDayRaw = text
      .split(";")
      .map((chunk) => chunk.trim())
      .find((chunk) => /^BYDAY=/i.test(chunk));
    const parsed = parseByDay((byDayRaw ?? "").slice("BYDAY=".length), rule.freq);
    rule.byDay = parsed.byDay;
    rule.byDayOrdinal = parsed.byDayOrdinal;
  }
  if (rule.count != null && rule.until != null) {
    throw new RecurrenceError("A repeat rule can end after N times or on a date, not both.");
  }
  return rule;
}

/** Parse without throwing — handy at trust boundaries and in the UI. */
export function safeParseRRule(
  input: string,
): { ok: true; rule: RecurrenceRule } | { ok: false; error: string } {
  try {
    return { ok: true, rule: parseRRule(input) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid repeat rule" };
  }
}

function formatUntilValue(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** Canonical RRULE text (no `RRULE:` prefix) for storage and ICS output. */
export function formatRRule(rule: RecurrenceRule): string {
  const parts: string[] = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay.length > 0) {
    const ordinal = rule.byDayOrdinal;
    parts.push(
      `BYDAY=${rule.byDay.map((day) => (ordinal == null ? day : `${ordinal}${day}`)).join(",")}`,
    );
  }
  if (rule.count != null) parts.push(`COUNT=${rule.count}`);
  if (rule.until != null) parts.push(`UNTIL=${formatUntilValue(rule.until)}`);
  return parts.join(";");
}

/* ------------------------------------------------------------------ *
 * Plain-English summary
 * ------------------------------------------------------------------ */

const ORDINAL_WORDS: Record<string, string> = {
  "1": "first",
  "2": "second",
  "3": "third",
  "4": "fourth",
  "5": "fifth",
  "-1": "last",
};

function joinWords(values: string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0]!;
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function shortDate(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * "Every Tuesday and Thursday until Feb 20" — the summary shown under the repeat
 * control so a mentor can read back what they just built.
 */
export function describeRRule(
  rule: RecurrenceRule | string,
  options: { start?: string; timeZone?: string } = {},
): string {
  let parsed: RecurrenceRule;
  if (typeof rule === "string") {
    const result = safeParseRRule(rule);
    if (!result.ok) return result.error;
    parsed = result.rule;
  } else {
    parsed = rule;
  }
  const timeZone = normalizeTimeZone(options.timeZone);
  const interval = parsed.interval;

  let base: string;
  if (parsed.freq === "DAILY") {
    base = interval === 1 ? "Every day" : `Every ${interval} days`;
  } else if (parsed.freq === "WEEKLY") {
    let days = parsed.byDay;
    if (days.length === 0 && options.start) {
      const parts = toLocalParts(new Date(options.start).getTime(), timeZone);
      days = [weekdayOfLocalDate(parts.year, parts.month, parts.day)];
    }
    const dayText = joinWords(days.map((day) => WEEKDAY_LABELS[day]));
    if (interval === 1) base = dayText ? `Every ${dayText}` : "Every week";
    else base = dayText ? `Every ${interval} weeks on ${dayText}` : `Every ${interval} weeks`;
  } else {
    const ordinal = parsed.byDayOrdinal;
    const day = parsed.byDay[0];
    const every = interval === 1 ? "Monthly" : `Every ${interval} months`;
    base =
      ordinal != null && day
        ? `${every} on the ${ORDINAL_WORDS[String(ordinal)] ?? `${ordinal}th`} ${WEEKDAY_LABELS[day]}`
        : every;
  }

  if (parsed.count != null) return `${base}, ${parsed.count} times`;
  if (parsed.until != null) return `${base} until ${shortDate(parsed.until, timeZone)}`;
  return base;
}

/* ------------------------------------------------------------------ *
 * Expansion
 * ------------------------------------------------------------------ */

export const EXCEPTION_ACTIONS = ["skipped", "moved", "edited"] as const;
export type ExceptionAction = (typeof EXCEPTION_ACTIONS)[number];

export type OccurrenceException = {
  /** ISO instant of the *original* occurrence start this exception replaces. */
  occurrenceDate: string;
  action: ExceptionAction;
};

export type Occurrence = {
  /** ISO instant of the occurrence start. */
  startsAt: string;
  /** ISO instant of the occurrence end, when the series has a duration. */
  endsAt: string | null;
  /** 0-based position in the series, counted from DTSTART including exceptions. */
  index: number;
};

export type ExpandInput = {
  rrule: string | RecurrenceRule;
  /** DTSTART as an ISO instant. */
  start: string;
  /** Series duration; when omitted occurrences have a null end. */
  durationMs?: number | null;
  /** IANA zone the wall-clock time is anchored to. */
  timeZone?: string;
  /** Inclusive window start (ISO instant). */
  windowStart: string;
  /** Exclusive window end (ISO instant). Always required — never expand unbounded. */
  windowEnd: string;
  exceptions?: OccurrenceException[];
  /** Denormalized `recurrence_end` date (YYYY-MM-DD, inclusive, series-local). */
  recurrenceEnd?: string | null;
  /** Safety valve; defaults to MAX_OCCURRENCES. */
  maxOccurrences?: number;
};

/** Candidate steps we are willing to walk before giving up (old unbounded series). */
const MAX_CANDIDATE_STEPS = 40000;

function nextWeeklyDates(
  rule: RecurrenceRule,
  startDay: number,
  startWeekday: Weekday,
): (step: number) => number[] {
  const days = rule.byDay.length > 0 ? rule.byDay : [startWeekday];
  // Monday-based offset of the week containing DTSTART.
  const startIndex = WEEKDAYS.indexOf(startWeekday);
  const weekAnchor = startDay - startIndex;
  const offsets = days.map((day) => WEEKDAYS.indexOf(day)).sort((a, b) => a - b);
  return (step: number) => offsets.map((offset) => weekAnchor + step * 7 * rule.interval + offset);
}

/**
 * Expand a series into concrete occurrences inside `[windowStart, windowEnd)`.
 *
 * Guarantees:
 * - never returns more than `maxOccurrences` (an unbounded rule is clamped by the
 *   window, and the window is mandatory);
 * - occurrences hold their wall-clock time across DST transitions;
 * - `skipped` / `moved` / `edited` exceptions are removed from the result (moved
 *   and edited occurrences live as detached rows), but still consume COUNT.
 */
export function expandOccurrences(input: ExpandInput): Occurrence[] {
  const rule = typeof input.rrule === "string" ? parseRRule(input.rrule) : input.rrule;
  const timeZone = normalizeTimeZone(input.timeZone);

  const startMs = new Date(input.start).getTime();
  if (Number.isNaN(startMs)) throw new RecurrenceError("Series start is not a valid date.");
  const windowStartMs = new Date(input.windowStart).getTime();
  const windowEndMs = new Date(input.windowEnd).getTime();
  if (Number.isNaN(windowStartMs) || Number.isNaN(windowEndMs)) {
    throw new RecurrenceError("Expansion window is not a valid date range.");
  }
  if (windowEndMs <= windowStartMs) return [];

  const max = Math.max(1, Math.min(input.maxOccurrences ?? MAX_OCCURRENCES, MAX_OCCURRENCES));
  const duration =
    input.durationMs != null && Number.isFinite(input.durationMs) && input.durationMs > 0
      ? input.durationMs
      : null;

  const skipInstants = new Set<string>();
  for (const exception of input.exceptions ?? []) {
    const ms = new Date(exception.occurrenceDate).getTime();
    if (Number.isNaN(ms)) continue;
    skipInstants.add(new Date(ms).toISOString());
  }

  // Hard end of the series: UNTIL and/or the denormalized recurrence_end date.
  let hardEndMs = rule.until != null ? new Date(rule.until).getTime() : Number.POSITIVE_INFINITY;
  if (input.recurrenceEnd) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(input.recurrenceEnd);
    if (match) {
      const endOfDay = localPartsToInstant(
        {
          year: Number(match[1]),
          month: Number(match[2]),
          day: Number(match[3]),
          hour: 23,
          minute: 59,
          second: 59,
        },
        timeZone,
      );
      hardEndMs = Math.min(hardEndMs, endOfDay);
    }
  }

  const startParts = toLocalParts(startMs, timeZone);
  const startDay = dayNumber(startParts.year, startParts.month, startParts.day);
  const startWeekday = weekdayOfLocalDate(startParts.year, startParts.month, startParts.day);
  const time = { hour: startParts.hour, minute: startParts.minute, second: startParts.second };

  const out: Occurrence[] = [];
  let generated = 0; // counts every occurrence from DTSTART — COUNT semantics
  let steps = 0;

  const emit = (dayNum: number): "continue" | "stop" => {
    const date = fromDayNumber(dayNum);
    const instant = localPartsToInstant(
      { year: date.year, month: date.month, day: date.day, ...time },
      timeZone,
    );
    if (instant < startMs) return "continue";
    if (instant > hardEndMs) return "stop";
    generated += 1;
    if (rule.count != null && generated > rule.count) return "stop";

    if (instant >= windowStartMs && instant < windowEndMs) {
      const iso = new Date(instant).toISOString();
      if (!skipInstants.has(iso)) {
        out.push({
          startsAt: iso,
          endsAt: duration != null ? new Date(instant + duration).toISOString() : null,
          index: generated - 1,
        });
      }
    }
    if (out.length >= max) return "stop";
    if (instant >= windowEndMs) return "stop";
    return "continue";
  };

  if (rule.freq === "DAILY") {
    const allowed = rule.byDay.length > 0 ? new Set(rule.byDay) : null;
    for (let step = 0; steps < MAX_CANDIDATE_STEPS; step += 1) {
      steps += 1;
      const dayNum = startDay + step * rule.interval;
      const date = fromDayNumber(dayNum);
      if (allowed && !allowed.has(weekdayOfLocalDate(date.year, date.month, date.day))) {
        // Still bounded: a filtered-out day cannot run forever because the window
        // check below uses the same day number.
        const probe = localPartsToInstant(
          { year: date.year, month: date.month, day: date.day, ...time },
          timeZone,
        );
        if (probe > hardEndMs || probe >= windowEndMs) break;
        continue;
      }
      if (emit(dayNum) === "stop") break;
    }
  } else if (rule.freq === "WEEKLY") {
    const datesForStep = nextWeeklyDates(rule, startDay, startWeekday);
    let stop = false;
    for (let step = 0; !stop && steps < MAX_CANDIDATE_STEPS; step += 1) {
      steps += 1;
      const days = datesForStep(step);
      for (const dayNum of days) {
        if (emit(dayNum) === "stop") {
          stop = true;
          break;
        }
      }
      if (stop) break;
      // Weeks advance monotonically, so once the last day of this week is past the
      // window (or past UNTIL) nothing later can qualify — this is what stops an
      // unbounded series from walking forever.
      const lastDay = days[days.length - 1]!;
      const probe = localPartsToInstant({ ...fromDayNumber(lastDay), ...time }, timeZone);
      if (probe >= windowEndMs || probe > hardEndMs) break;
    }
  } else {
    // MONTHLY
    for (let step = 0; steps < MAX_CANDIDATE_STEPS; step += 1) {
      steps += 1;
      const monthIndex = (startParts.year * 12 + (startParts.month - 1)) + step * rule.interval;
      const year = Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;

      const dayOfMonth: number | null =
        rule.byDayOrdinal != null && rule.byDay[0]
          ? nthWeekdayOfMonth(year, month, rule.byDay[0], rule.byDayOrdinal)
          : startParts.day <= daysInMonth(year, month)
            ? startParts.day
            : null;
      if (dayOfMonth == null) {
        // RFC 5545: months without the target day are simply skipped.
        const probe = localPartsToInstant(
          { year, month, day: 1, ...time },
          timeZone,
        );
        if (probe > hardEndMs || probe >= windowEndMs) break;
        continue;
      }
      if (emit(dayNumber(year, month, dayOfMonth)) === "stop") break;
    }
  }

  out.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
  return out.slice(0, max);
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: Weekday,
  ordinal: number,
): number | null {
  const total = daysInMonth(year, month);
  const matches: number[] = [];
  for (let day = 1; day <= total; day += 1) {
    if (weekdayOfLocalDate(year, month, day) === weekday) matches.push(day);
  }
  if (matches.length === 0) return null;
  if (ordinal === -1) return matches[matches.length - 1]!;
  return matches[ordinal - 1] ?? null;
}

/* ------------------------------------------------------------------ *
 * Occurrence identity (composite ids for virtual occurrences)
 * ------------------------------------------------------------------ */

/**
 * Virtual occurrences have no row of their own, so the API addresses them as
 * `<series row uuid>#<original occurrence ISO instant>`. The first occurrence
 * keeps the master row's plain uuid so existing RSVPs and attendance links
 * survive turning an event into a series.
 */
export function occurrenceId(masterId: string, occurrenceStartIso: string): string {
  return `${masterId}#${occurrenceStartIso}`;
}

export function parseOccurrenceId(
  value: string,
): { masterId: string; occurrenceDate: string } | null {
  if (typeof value !== "string") return null;
  const hash = value.indexOf("#");
  if (hash < 0) return null;
  const masterId = value.slice(0, hash);
  const occurrenceDate = value.slice(hash + 1);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(masterId)) return null;
  const ms = new Date(occurrenceDate).getTime();
  if (Number.isNaN(ms)) return null;
  return { masterId, occurrenceDate: new Date(ms).toISOString() };
}

/* ------------------------------------------------------------------ *
 * Building a rule from the UI's repeat control
 * ------------------------------------------------------------------ */

export type RepeatPreset = "none" | "daily" | "weekly" | "biweekly" | "monthly";

export type RepeatDraft = {
  preset: RepeatPreset;
  /** WEEKLY/biweekly: selected weekdays. Empty = the start date's weekday. */
  days: Weekday[];
  /** "never" | "on" | "after" */
  endMode: "never" | "on" | "after";
  /** YYYY-MM-DD when endMode = "on". */
  endsOn: string;
  /** Occurrence total when endMode = "after". */
  count: number;
};

export const EMPTY_REPEAT_DRAFT: RepeatDraft = {
  preset: "none",
  days: [],
  endMode: "never",
  endsOn: "",
  count: 10,
};

/**
 * Turn the repeat control's state into an RRULE string (or null for
 * "does not repeat"). Throws `RecurrenceError` on an impossible combination.
 */
export function draftToRRule(
  draft: RepeatDraft,
  options: { start: string; timeZone?: string },
): string | null {
  if (draft.preset === "none") return null;
  const timeZone = normalizeTimeZone(options.timeZone);
  const startMs = new Date(options.start).getTime();
  if (Number.isNaN(startMs)) throw new RecurrenceError("Pick a start date before repeating.");
  const startParts = toLocalParts(startMs, timeZone);

  const rule: RecurrenceRule = {
    freq: "WEEKLY",
    interval: 1,
    byDay: [],
    byDayOrdinal: null,
    count: null,
    until: null,
  };

  if (draft.preset === "daily") {
    rule.freq = "DAILY";
  } else if (draft.preset === "monthly") {
    rule.freq = "MONTHLY";
  } else {
    rule.freq = "WEEKLY";
    rule.interval = draft.preset === "biweekly" ? 2 : 1;
    const days =
      draft.days.length > 0
        ? [...draft.days].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b))
        : [weekdayOfLocalDate(startParts.year, startParts.month, startParts.day)];
    rule.byDay = days;
  }

  if (draft.endMode === "after") {
    const count = Math.trunc(draft.count);
    if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
      throw new RecurrenceError(`Repeat count must be between 1 and ${MAX_COUNT}.`);
    }
    rule.count = count;
  } else if (draft.endMode === "on") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(draft.endsOn.trim());
    if (!match) throw new RecurrenceError("Pick the date the repeat ends on.");
    const endInstant = localPartsToInstant(
      {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
        hour: 23,
        minute: 59,
        second: 59,
      },
      timeZone,
    );
    if (endInstant < startMs) throw new RecurrenceError("The repeat end is before the start.");
    rule.until = new Date(endInstant).toISOString();
  }

  return formatRRule(rule);
}

/** Inverse of `draftToRRule`, for editing an existing series in the UI. */
export function rruleToDraft(
  rruleText: string | null,
  options: { timeZone?: string } = {},
): RepeatDraft {
  if (!rruleText) return { ...EMPTY_REPEAT_DRAFT };
  const parsed = safeParseRRule(rruleText);
  if (!parsed.ok) return { ...EMPTY_REPEAT_DRAFT };
  const rule = parsed.rule;
  const timeZone = normalizeTimeZone(options.timeZone);

  const preset: RepeatPreset =
    rule.freq === "DAILY"
      ? "daily"
      : rule.freq === "MONTHLY"
        ? "monthly"
        : rule.interval === 2
          ? "biweekly"
          : "weekly";

  let endMode: RepeatDraft["endMode"] = "never";
  let endsOn = "";
  let count = EMPTY_REPEAT_DRAFT.count;
  if (rule.count != null) {
    endMode = "after";
    count = rule.count;
  } else if (rule.until != null) {
    endMode = "on";
    const parts = toLocalParts(new Date(rule.until).getTime(), timeZone);
    endsOn = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }

  return { preset, days: rule.byDay, endMode, endsOn, count };
}

/** Denormalized `recurrence_end` (YYYY-MM-DD) for the DB column, when known. */
export function recurrenceEndDate(
  rruleText: string | null,
  options: { timeZone?: string } = {},
): string | null {
  if (!rruleText) return null;
  const parsed = safeParseRRule(rruleText);
  if (!parsed.ok || parsed.rule.until == null) return null;
  const parts = toLocalParts(new Date(parsed.rule.until).getTime(), normalizeTimeZone(options.timeZone));
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** YYYY-MM-DD of an instant in the series timezone (used for "this and following"). */
export function localDateOf(iso: string, timeZone: string): string {
  const parts = toLocalParts(new Date(iso).getTime(), normalizeTimeZone(timeZone));
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** The day before `iso` in the series timezone — the cutoff for "this and following". */
export function previousLocalDate(iso: string, timeZone: string): string {
  const zone = normalizeTimeZone(timeZone);
  const parts = toLocalParts(new Date(iso).getTime(), zone);
  const previous = fromDayNumber(dayNumber(parts.year, parts.month, parts.day) - 1);
  return `${previous.year}-${String(previous.month).padStart(2, "0")}-${String(previous.day).padStart(2, "0")}`;
}
