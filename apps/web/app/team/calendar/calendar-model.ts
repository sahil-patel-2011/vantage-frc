import type { RecurrenceEventFields } from "../../../lib/calendar/series";
import type { EventDraft } from "../../../lib/calendar-ai/pick";
import type { CalendarEvent, SubteamCalendarView } from "../../../lib/subteam-calendar";

export type ActionBody = Record<string, unknown> & { action: string; orgId: string };
export type ReadyView = Extract<SubteamCalendarView, { status: "ready" }>;

/**
 * Events as the calendar API returns them once migration 0456 is applied: the
 * recurrence fields are additive, so everything still renders without them.
 */
export type RecurringEvent = CalendarEvent & RecurrenceEventFields;

export type Tab = "calendar" | "subteams" | "duties" | "trip" | "sync";
export type DutyScope = "team" | "mine";
export type EventPrefill = EventDraft & { nonce: number };

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** True when changing this entry could touch more than the one meeting shown. */
export function isSeriesEvent(event: RecurringEvent): boolean {
  return Boolean(event.seriesId && (event.isOccurrence || event.rrule));
}

export function withOrg(path: string, orgId: string) {
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}orgId=${encodeURIComponent(orgId)}`;
}

export function fmtWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * A start and an end, with the date said once.
 *
 * A fifteen-minute qualification match read "Thu, Sep 17, 7:45 AM → Thu, Sep
 * 17, 8:00 AM", under a heading that already said THURSDAY, SEP 17 — three
 * dates for one match, and on a phone it wrapped to two lines. An event that
 * ends on a later day still gets both, because then the date is the point.
 */
export function fmtRange(startIso: string, endIso?: string | null): string {
  const start = fmtWhen(startIso);
  if (!endIso) return start;
  const from = new Date(startIso);
  const to = new Date(endIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return `${start} → ${fmtWhen(endIso)}`;
  const sameDay = from.toDateString() === to.toDateString();
  return `${start} → ${sameDay ? fmtTime(endIso) : fmtWhen(endIso)}`;
}

export function dayNum(day: string): string {
  return String(Number(day.slice(8, 10)));
}

export function formatDayLabelLocal(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
