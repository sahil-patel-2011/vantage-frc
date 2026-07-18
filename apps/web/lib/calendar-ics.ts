/**
 * iCalendar (.ics / RFC 5545) builder for Vantage calendar subscription feeds.
 *
 * ## Timezone handling
 *
 * - **Timed events** (`allDay: false`) are emitted as UTC stamps (`…Z`).
 *   Postgres `timestamptz` values are converted with `Date` → UTC. Google,
 *   Apple, and Outlook then show them in the subscriber's local zone.
 * - **All-day milestones** (`allDay: true`) use `VALUE=DATE` with the bare
 *   `YYYYMMDD` calendar date. They are *floating* dates (no timezone) so a
 *   "Kickoff" on Jan 3 stays Jan 3 in every shop, not shifted by UTC offset.
 * - The calendar advertises `X-WR-TIMEZONE:UTC` for clients that honor it;
 *   do not invent a team timezone until orgs store one explicitly.
 * - Never emit wall-clock "local" times without a VTIMEZONE block — that
 *   silently drifts across DST. Prefer UTC timed + DATE all-day.
 *
 * Framework-free and deterministic (no wall-clock reads) so unit tests stay
 * stable and the public feed route stays cheap.
 */

export type CalendarIcsEvent = {
  id: string;
  title: string;
  kind: string;
  location: string;
  description: string;
  /** ISO timestamptz, or YYYY-MM-DD when allDay. */
  startsAt: string;
  endsAt: string | null;
  updatedAt: string;
  allDay?: boolean;
};

export type CalendarIcsFeed = {
  orgName: string | null;
  teamNumber: number | null;
  scope?: string;
  timezone?: string;
  events: CalendarIcsEvent[];
};

const DEFAULT_DURATION_MS = 60 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Format an ISO/timestamp string as a UTC iCalendar stamp: 20260310T230000Z. */
export function formatUtc(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** YYYY-MM-DD (or ISO prefix) → floating DATE value YYYYMMDD. */
export function formatDateValue(value: string): string | null {
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return day.replace(/-/g, "");
}

/** Escape a text value per RFC 5545 §3.3.11. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold a content line to <=75 octets with CRLF + single space continuations. */
function foldLine(content: string): string {
  if (content.length <= 75) return content;
  const parts: string[] = [];
  let rest = content;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  return parts.join("\r\n");
}

function prop(name: string, value: string): string {
  return foldLine(`${name}:${value}`);
}

function calendarName(feed: CalendarIcsFeed): string {
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

function buildEventLines(event: CalendarIcsEvent, domain: string): string[] | null {
  const stamp =
    formatUtc(event.updatedAt) ?? formatUtc(event.startsAt) ?? formatUtc("1970-01-01T00:00:00.000Z");
  if (!stamp) return null;

  const out: string[] = [
    "BEGIN:VEVENT",
    prop("UID", `${event.id}@${domain}`),
    prop("DTSTAMP", stamp),
  ];

  if (event.allDay) {
    const startDay = formatDateValue(event.startsAt);
    if (!startDay) return null;
    const endDayRaw = formatDateValue(event.endsAt ?? event.startsAt) ?? startDay;
    out.push(prop("DTSTART;VALUE=DATE", startDay));
    out.push(prop("DTEND;VALUE=DATE", exclusiveDateAfter(endDayRaw)));
  } else {
    const start = formatUtc(event.startsAt);
    if (!start) return null;
    const endSource =
      event.endsAt ?? new Date(new Date(event.startsAt).getTime() + DEFAULT_DURATION_MS).toISOString();
    const end = formatUtc(endSource) ?? start;
    out.push(prop("DTSTART", start));
    out.push(prop("DTEND", end));
  }

  out.push(prop("SUMMARY", escapeText(event.title)));
  if (event.location) out.push(prop("LOCATION", escapeText(event.location)));
  if (event.description) out.push(prop("DESCRIPTION", escapeText(event.description)));
  if (event.kind) out.push(prop("CATEGORIES", escapeText(event.kind.toUpperCase())));
  out.push("END:VEVENT");
  return out;
}

/**
 * Build a complete VCALENDAR document. `domain` makes each event UID globally
 * unique and stable across refreshes.
 */
export function buildCalendar(feed: CalendarIcsFeed, opts: { domain: string }): string {
  const domain = opts.domain.replace(/[^a-z0-9.-]/gi, "") || "vantagefrc";
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vantage FRC//Team Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    prop("X-WR-CALNAME", escapeText(calendarName(feed))),
    "X-WR-TIMEZONE:UTC",
  ];

  for (const event of feed.events) {
    const eventLines = buildEventLines(event, domain);
    if (eventLines) lines.push(...eventLines);
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

/** Google Calendar subscribe URL for a webcal/https ICS feed. */
export function googleCalendarSubscribeUrl(webcalOrHttpsUrl: string): string {
  const webcal = webcalOrHttpsUrl.replace(/^https?:/i, "webcal:");
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
}

export function toWebcalUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^https?:/i, "webcal:");
}
