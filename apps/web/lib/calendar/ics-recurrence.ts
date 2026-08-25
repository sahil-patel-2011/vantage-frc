/**
 * Recurrence-aware iCalendar output for the tokenized subscribe feed.
 *
 * The base builder (`apps/web/lib/calendar-ics.ts`) emits every event as a
 * standalone UTC `VEVENT`. That is correct for one-off events but wrong for a
 * build-season series: expanding "Tuesday and Thursday 6-9pm for fourteen weeks"
 * into ~50 copies makes the feed enormous, makes edits in Google impossible, and
 * — because the copies are UTC instants — silently drifts an hour when the
 * November DST change lands mid-season.
 *
 * So series rows are emitted the way RFC 5545 intends:
 *
 *   BEGIN:VTIMEZONE … END:VTIMEZONE     (one per distinct series zone)
 *   DTSTART;TZID=America/New_York:20260113T180000
 *   RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20260220T045959Z
 *   EXDATE;TZID=America/New_York:20261124T180000
 *
 * Google, Apple, and Outlook then expand the series themselves and keep 6pm at
 * 6pm across the transition. Detached occurrences ("this Tuesday we start at 5")
 * ride along as a second VEVENT with the same UID plus `RECURRENCE-ID`, which is
 * the standard override mechanism.
 *
 * The `VTIMEZONE` blocks are generated from offsets actually observed through
 * `Intl` over the feed window, emitted as explicit onsets (`RDATE`) rather than
 * guessed yearly rules — exact, and only a handful of lines.
 *
 * Non-recurring rows keep byte-for-byte the shape `buildCalendar` already
 * produced, so existing subscribers see no churn. Deterministic and pure: `now`
 * is injected, never read.
 */

import {
  escapeText,
  formatDateValue,
  formatUtc,
  type CalendarIcsEvent,
  type CalendarIcsFeed,
} from "../calendar-ics";
import {
  normalizeTimeZone,
  safeParseRRule,
  timeZoneOffsetMs,
  toLocalParts,
  type LocalParts,
} from "./recurrence";

/** A feed event that may carry recurrence. Extends the base shape additively. */
export type RecurringIcsEvent = CalendarIcsEvent & {
  /** Canonical RRULE text (no `RRULE:` prefix). Only set on a series master. */
  rrule?: string | null;
  /** Denormalized inclusive end date; informational only, UNTIL wins. */
  recurrenceEnd?: string | null;
  /** IANA zone the series' wall-clock time is anchored to. */
  timeZone?: string | null;
  /** Original occurrence instants removed from the series (EXDATE). */
  exdates?: string[] | null;
  /** On a detached row: the original occurrence instant it replaces. */
  recurrenceId?: string | null;
  /** On a detached row: the master row's id, so UIDs match. */
  seriesUid?: string | null;
};

export type RecurringIcsFeed = Omit<CalendarIcsFeed, "events"> & {
  events: RecurringIcsEvent[];
};

const DEFAULT_DURATION_MS = 60 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Fold a content line to <=75 octets with CRLF + single-space continuations. */
function foldLine(content: string): string {
  if (content.length <= 75) return content;
  const parts: string[] = [content.slice(0, 75)];
  let rest = content.slice(75);
  while (rest.length > 0) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  return parts.join("\r\n");
}

function prop(name: string, value: string): string {
  return foldLine(`${name}:${value}`);
}

/** Wall-clock parts → the iCalendar local form `20260113T180000` (no Z). */
export function formatLocalStamp(parts: LocalParts): string {
  return (
    `${String(parts.year).padStart(4, "0")}${pad(parts.month)}${pad(parts.day)}` +
    `T${pad(parts.hour)}${pad(parts.minute)}${pad(parts.second)}`
  );
}

/** An instant rendered as local wall-clock text in `timeZone`. */
export function localStampIn(iso: string, timeZone: string): string | null {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return formatLocalStamp(toLocalParts(ms, timeZone));
}

/** Milliseconds east of UTC → `+HHMM` / `-HHMM` (seconds appended when nonzero). */
export function formatUtcOffset(offsetMs: number): string {
  const sign = offsetMs < 0 ? "-" : "+";
  const total = Math.abs(Math.round(offsetMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${sign}${pad(hours)}${pad(minutes)}${seconds > 0 ? pad(seconds) : ""}`;
}

/** Short zone abbreviation (EST/EDT). Falls back to the numeric offset. */
function zoneAbbreviation(instantMs: number, timeZone: string, offsetMs: number): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(new Date(instantMs));
    const name = parts.find((part) => part.type === "timeZoneName")?.value;
    if (name && /^[A-Za-z]{2,6}$/.test(name)) return name;
    if (name) return name;
  } catch {
    // fall through to the numeric form
  }
  return `GMT${formatUtcOffset(offsetMs)}`;
}

export type ZoneTransition = {
  /** Instant the new offset takes effect. */
  atMs: number;
  offsetFromMs: number;
  offsetToMs: number;
  /** True when the new offset is the larger (summer) one for this zone. */
  daylight: boolean;
  name: string;
};

const DAY_MS = 86400000;

/**
 * Offset changes in `timeZone` across `[fromMs, toMs]`, found by a daily probe
 * plus a binary search down to the minute. A zone with no transitions in the
 * window (UTC, Phoenix) yields an empty list — the caller emits a single fixed
 * STANDARD component instead.
 */
export function findZoneTransitions(
  timeZone: string,
  fromMs: number,
  toMs: number,
): ZoneTransition[] {
  const out: ZoneTransition[] = [];
  if (!(toMs > fromMs)) return out;
  // A hard cap keeps a nonsense window from spinning: ~20 years of daily probes.
  const maxProbes = 8000;
  let previousOffset = timeZoneOffsetMs(fromMs, timeZone);
  let previousMs = fromMs;
  let probes = 0;

  for (let cursor = fromMs + DAY_MS; cursor <= toMs && probes < maxProbes; cursor += DAY_MS) {
    probes += 1;
    const offset = timeZoneOffsetMs(cursor, timeZone);
    if (offset === previousOffset) {
      previousMs = cursor;
      previousOffset = offset;
      continue;
    }
    // Narrow [previousMs, cursor] to the minute the change lands on.
    let low = previousMs;
    let high = cursor;
    while (high - low > 60000) {
      const mid = low + Math.floor((high - low) / 2);
      if (timeZoneOffsetMs(mid, timeZone) === previousOffset) low = mid;
      else high = mid;
    }
    const atMs = high - (high % 60000);
    const offsetTo = timeZoneOffsetMs(atMs, timeZone);
    out.push({
      atMs,
      offsetFromMs: previousOffset,
      offsetToMs: offsetTo,
      daylight: offsetTo > previousOffset,
      name: zoneAbbreviation(atMs + 60000, timeZone, offsetTo),
    });
    previousOffset = offsetTo;
    previousMs = cursor;
  }
  return out;
}

/**
 * A `VTIMEZONE` block for `timeZone` covering the window, using observed onsets.
 * Returns null for an unusable zone so the caller can fall back to UTC stamps.
 */
export function buildVTimeZone(
  timeZone: string,
  windowStartMs: number,
  windowEndMs: number,
): string[] | null {
  const zone = normalizeTimeZone(timeZone);
  if (zone === "UTC") return null;

  let baseOffset: number;
  try {
    baseOffset = timeZoneOffsetMs(windowStartMs, zone);
  } catch {
    return null;
  }

  const transitions = findZoneTransitions(zone, windowStartMs, windowEndMs);
  const lines: string[] = ["BEGIN:VTIMEZONE", prop("TZID", zone)];

  if (transitions.length === 0) {
    // Fixed-offset zone: one STANDARD component anchored at the epoch.
    lines.push(
      "BEGIN:STANDARD",
      prop("DTSTART", "19700101T000000"),
      prop("TZOFFSETFROM", formatUtcOffset(baseOffset)),
      prop("TZOFFSETTO", formatUtcOffset(baseOffset)),
      prop("TZNAME", zoneAbbreviation(windowStartMs, zone, baseOffset)),
      "END:STANDARD",
    );
    lines.push("END:VTIMEZONE");
    return lines;
  }

  const daylight = transitions.filter((t) => t.daylight);
  const standard = transitions.filter((t) => !t.daylight);

  const emit = (group: ZoneTransition[], kind: "DAYLIGHT" | "STANDARD") => {
    if (group.length === 0) return;
    const first = group[0]!;
    // DTSTART inside VTIMEZONE is local time expressed in the *previous* offset.
    const onsetLocal = (transition: ZoneTransition) =>
      formatLocalStamp(toLocalParts(transition.atMs + transition.offsetFromMs, "UTC"));
    lines.push(
      `BEGIN:${kind}`,
      prop("DTSTART", onsetLocal(first)),
      prop("TZOFFSETFROM", formatUtcOffset(first.offsetFromMs)),
      prop("TZOFFSETTO", formatUtcOffset(first.offsetToMs)),
      prop("TZNAME", first.name),
    );
    for (const transition of group.slice(1)) {
      lines.push(prop("RDATE", onsetLocal(transition)));
    }
    lines.push(`END:${kind}`);
  };

  emit(standard, "STANDARD");
  emit(daylight, "DAYLIGHT");
  lines.push("END:VTIMEZONE");
  return lines;
}

function calendarName(feed: RecurringIcsFeed): string {
  const team = feed.teamNumber ? `Team ${feed.teamNumber}` : (feed.orgName ?? "Team");
  const scope =
    feed.scope === "org" ? " (team)" : feed.scope === "subteam" ? " (subteam)" : " (personal)";
  return `${team} — Vantage${scope}`;
}

function exclusiveDateAfter(yyyymmdd: string): string {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
}

/** The zone of a row that carries an RRULE we can emit. Null for one-off rows. */
function seriesZoneOf(event: RecurringIcsEvent): string | null {
  if (!event.rrule || event.allDay) return null;
  if (!safeParseRRule(event.rrule).ok) return null;
  return normalizeTimeZone(event.timeZone);
}

/** True when this row overrides a single occurrence of another row's series. */
function isOverride(event: RecurringIcsEvent): boolean {
  return Boolean(event.recurrenceId && event.seriesUid && !event.allDay);
}

/**
 * The zone DTSTART/DTEND are written in. Series masters and their overrides both
 * use TZID so the override lines up with the onset it replaces; everything else
 * keeps the plain UTC stamps existing subscribers already have.
 */
function displayZoneOf(event: RecurringIcsEvent): string | null {
  const seriesZone = seriesZoneOf(event);
  if (seriesZone) return seriesZone;
  if (isOverride(event)) return normalizeTimeZone(event.timeZone);
  return null;
}

function buildEventLines(
  event: RecurringIcsEvent,
  domain: string,
  zonesUsed: Set<string>,
): string[] | null {
  const stamp =
    formatUtc(event.updatedAt) ?? formatUtc(event.startsAt) ?? formatUtc("1970-01-01T00:00:00.000Z");
  if (!stamp) return null;

  // A detached override shares the master's UID; that is what pairs it with the
  // series in Google/Apple instead of showing up as a duplicate event.
  const uidSource = isOverride(event) ? event.seriesUid! : event.id;
  const out: string[] = [
    "BEGIN:VEVENT",
    prop("UID", `${uidSource}@${domain}`),
    prop("DTSTAMP", stamp),
  ];

  const seriesZone = seriesZoneOf(event);
  const zone = displayZoneOf(event);

  if (event.allDay) {
    const startDay = formatDateValue(event.startsAt);
    if (!startDay) return null;
    const endDayRaw = formatDateValue(event.endsAt ?? event.startsAt) ?? startDay;
    out.push(prop("DTSTART;VALUE=DATE", startDay));
    out.push(prop("DTEND;VALUE=DATE", exclusiveDateAfter(endDayRaw)));
  } else if (zone && zone !== "UTC") {
    const startLocal = localStampIn(event.startsAt, zone);
    if (!startLocal) return null;
    const endSource =
      event.endsAt ??
      new Date(new Date(event.startsAt).getTime() + DEFAULT_DURATION_MS).toISOString();
    const endLocal = localStampIn(endSource, zone) ?? startLocal;
    zonesUsed.add(zone);
    out.push(prop(`DTSTART;TZID=${zone}`, startLocal));
    out.push(prop(`DTEND;TZID=${zone}`, endLocal));
  } else {
    const start = formatUtc(event.startsAt);
    if (!start) return null;
    const endSource =
      event.endsAt ??
      new Date(new Date(event.startsAt).getTime() + DEFAULT_DURATION_MS).toISOString();
    const end = formatUtc(endSource) ?? start;
    out.push(prop("DTSTART", start));
    out.push(prop("DTEND", end));
  }

  if (seriesZone) {
    out.push(prop("RRULE", event.rrule!.trim().replace(/^RRULE:/i, "")));
    const exdates = (event.exdates ?? [])
      .map((value) => (seriesZone === "UTC" ? formatUtc(value) : localStampIn(value, seriesZone)))
      .filter((value): value is string => Boolean(value));
    if (exdates.length > 0) {
      // One EXDATE line carrying every skipped onset — folded if long.
      out.push(
        seriesZone === "UTC"
          ? prop("EXDATE", exdates.join(","))
          : prop(`EXDATE;TZID=${seriesZone}`, exdates.join(",")),
      );
    }
  } else if (isOverride(event)) {
    const overrideZone = zone ?? "UTC";
    if (overrideZone === "UTC") {
      const value = formatUtc(event.recurrenceId!);
      if (value) out.push(prop("RECURRENCE-ID", value));
    } else {
      const value = localStampIn(event.recurrenceId!, overrideZone);
      if (value) out.push(prop(`RECURRENCE-ID;TZID=${overrideZone}`, value));
    }
  }

  out.push(prop("SUMMARY", escapeText(event.title)));
  if (event.location) out.push(prop("LOCATION", escapeText(event.location)));
  if (event.description) out.push(prop("DESCRIPTION", escapeText(event.description)));
  if (event.kind) out.push(prop("CATEGORIES", escapeText(event.kind.toUpperCase())));
  out.push("END:VEVENT");
  return out;
}

/**
 * Build a complete VCALENDAR, emitting series as real RRULEs. `now` is injected
 * so the VTIMEZONE window is deterministic in tests.
 */
export function buildRecurringCalendar(
  feed: RecurringIcsFeed,
  opts: { domain: string; now?: Date },
): string {
  const domain = opts.domain.replace(/[^a-z0-9.-]/gi, "") || "vantagefrc";
  const nowMs = (opts.now ?? new Date(0)).getTime();

  const zonesUsed = new Set<string>();
  const eventBlocks: string[][] = [];
  for (const event of feed.events) {
    const lines = buildEventLines(event, domain, zonesUsed);
    if (lines) eventBlocks.push(lines);
  }

  // Cover well past the feed window so a client resolving any onset in the
  // series (including a long UNTIL) finds a rule for it.
  const windowStart = nowMs - 400 * DAY_MS;
  const windowEnd = nowMs + 800 * DAY_MS;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vantage FRC//Team Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    prop("X-WR-CALNAME", escapeText(calendarName(feed))),
    "X-WR-TIMEZONE:UTC",
  ];

  for (const zone of [...zonesUsed].sort()) {
    const block = buildVTimeZone(zone, windowStart, windowEnd);
    if (block) lines.push(...block);
  }

  for (const block of eventBlocks) lines.push(...block);

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
