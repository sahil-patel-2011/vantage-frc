import { validateCustomEvent, customEventProblemCopy, type CustomEventDraft } from "./custom-event";
import { isValidTimeZone, localPartsToInstant, toLocalParts, normalizeTimeZone } from "../calendar/recurrence";

export type PlannedCompetition = {
  eventKey: string;
  name: string;
  year: number;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  stateProv: string | null;
  custom: boolean;
  eventType: number;
  timeZone?: string | null;
  calendarId?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  autoActivate?: boolean;
  catalogId?: string;
  sourceUrl?: string;
};

// Organizer-published facts, not generated examples. Other years need their
// own published dates; never project this year's dates into the next season.
const ORGANIZER_EVENTS: PlannedCompetition[] = [{
  eventKey: "catalog:grits-2026", catalogId: "grits-2026", name: "GRITS 2026",
  year: 2026, startDate: "2026-10-15", endDate: "2026-10-17",
  city: "Gainesville", stateProv: "Georgia", custom: true, eventType: 99,
  timeZone: "America/New_York",
  sourceUrl: "https://gafirst.org/events/grits-2026",
}];

export function organizerEvents(year: number | null, query: string, stored: readonly PlannedCompetition[]): PlannedCompetition[] {
  const q = query.trim().toLowerCase();
  return ORGANIZER_EVENTS.filter(event => (year === null || event.year === year)
    && (!q || [event.name, event.city, event.stateProv].join(" ").toLowerCase().includes(q))
    && !stored.some(row => row.name.toLowerCase().replace(/[^a-z0-9]/g, "") === event.name.toLowerCase().replace(/[^a-z0-9]/g, "")
      || (event.catalogId === "grits-2026" && /^grits(?:\s+2026)?$/i.test(row.name.trim()))));
}

export function organizerEvent(id: string): PlannedCompetition | undefined {
  return ORGANIZER_EVENTS.find(event => event.catalogId === id);
}

export function parseEventYear(value: string | null, fallback = new Date().getFullYear()): number {
  const year = value == null ? fallback : Number(value);
  if (!Number.isInteger(year) || year < 1992 || year > 2100) throw new Error("Choose a season from 1992 to 2100.");
  return year;
}

export function validateCompetitionDraft(draft: CustomEventDraft): void {
  const problems = validateCustomEvent(draft);
  if (problems.length) throw new Error(problems.map(customEventProblemCopy).join(" "));
}

export type CompetitionSchedule = { startsAt: string; endsAt: string; timeZone: string; autoActivate: boolean };

export function parseCompetitionSchedule(input: unknown): CompetitionSchedule {
  if (!input || typeof input !== "object") throw new Error("Choose the competition's start and end dates.");
  const row = input as Record<string, unknown>;
  const parse = (value: unknown) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
    if (validateCustomEvent({ name: "Competition", year: Number(value.slice(0, 4)), startDate: value.slice(0, 10) }).length) return NaN;
    return Date.parse(value);
  };
  const start = parse(row.startsAt), end = parse(row.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("The competition must end after it starts.");
  if (end - start > 31 * 86400000) throw new Error("Keep one competition within 31 days.");
  if (typeof row.timeZone !== "string") throw new Error("Choose a valid time zone.");
  try { new Intl.DateTimeFormat("en", { timeZone: row.timeZone }).format(); }
  catch { throw new Error("Choose a valid time zone."); }
  if (typeof row.autoActivate !== "boolean") throw new Error("Choose whether this event becomes active automatically.");
  return { startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), timeZone: row.timeZone, autoActivate: row.autoActivate };
}

/** Calendar end is exclusive; the UI's last day is inclusive, including DST. */
export function dateSchedule(start: string, lastDay: string, autoActivate: boolean, zone?: string): CompetitionSchedule {
  validateCompetitionDraft({ name: "Competition", year: Number(start.slice(0, 4)), startDate: start, endDate: lastDay || start });
  const timeZone = (zone || Intl.DateTimeFormat().resolvedOptions().timeZone).trim();
  if (!isValidTimeZone(timeZone)) throw new Error("Choose a valid event time zone.");
  const instant = (day: string) => {
    const [year, month, date] = day.split("-").map(Number);
    return localPartsToInstant({ year: year!, month: month!, day: date!, hour: 0, minute: 0, second: 0 }, timeZone);
  };
  const afterLastDay = new Date(`${lastDay || start}T00:00:00Z`);
  afterLastDay.setUTCDate(afterLastDay.getUTCDate() + 1);
  return parseCompetitionSchedule({ startsAt: new Date(instant(start)).toISOString(), endsAt: new Date(instant(afterLastDay.toISOString().slice(0, 10))).toISOString(), timeZone, autoActivate });
}

export function competitionDay(instant: string, zone?: string | null): string {
  const parts = toLocalParts(Date.parse(instant), normalizeTimeZone(zone || Intl.DateTimeFormat().resolvedOptions().timeZone));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}
export function plannedLastDay(endsAt: string, zone?: string | null): string {
  return competitionDay(new Date(Date.parse(endsAt) - 1).toISOString(), zone);
}

export function competitionCalendarDays(event: { startsAt: string; endsAt: string | null; competitionTimeZone?: string | null }): string[] {
  const first = competitionDay(event.startsAt, event.competitionTimeZone);
  const last = event.endsAt ? plannedLastDay(event.endsAt, event.competitionTimeZone) : first;
  const days: string[] = [];
  const cursor = new Date(`${first}T00:00:00Z`);
  // Product schedules are bounded to 31 days; a corrupt historical row must
  // not allocate an unbounded array while painting the calendar.
  for (let i = 0; i < 32 && cursor.toISOString().slice(0, 10) <= last; i++) {
    days.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function competitionCalendarLabel(event: { startsAt: string; endsAt: string | null; competitionTimeZone?: string | null }): string {
  const first = competitionDay(event.startsAt, event.competitionTimeZone);
  const last = event.endsAt ? plannedLastDay(event.endsAt, event.competitionTimeZone) : first;
  const formatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `All day · ${formatter.formatRange(new Date(`${first}T12:00:00Z`), new Date(`${last}T12:00:00Z`))}`;
}
