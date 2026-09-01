// Agenda + minutes persist against a real calendar meeting (subteam_calendar_events
// kind = 'meeting'). Nothing here invents a meeting, an agenda item, or minutes text —
// empty stays empty until a meeting exists and a human writes minutes.

import type { AgendaItem } from "./types";

export const CALENDAR_MEETING_KIND = "meeting" as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AGENDA_KINDS = new Set(["blocker", "overdue_task", "decision", "fmea"]);

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/** Throws unless the caller named a real calendar event. */
export function requireCalendarEventId(value: unknown): string {
  if (typeof value === "string" && isUuid(value.trim())) return value.trim();
  throw new Error("calendarEventId is required — agenda and minutes persist against a calendar meeting");
}

export type AgendaPersistPayload = {
  calendarEventId: string | null;
  minutesText: string | null;
  items: AgendaItem[];
};

function isAgendaItem(value: unknown): value is AgendaItem {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return (
    AGENDA_KINDS.has(String(rec.kind)) &&
    typeof rec.sourceId === "string" &&
    typeof rec.title === "string" &&
    typeof rec.detail === "string" &&
    typeof rec.weight === "number"
  );
}

/**
 * Decode the `meeting_autopilot_agendas.agenda_items` jsonb column.
 * Legacy rows stored a bare AgendaItem[] or wrapped { calendarEventId, minutesText, items }.
 * Event id now lives on calendar_event_id — jsonb calendarEventId is a fallback only.
 * Missing minutes stay null — never a canned DEMO string.
 */
export function decodeAgendaPayload(raw: unknown): AgendaPersistPayload {
  if (Array.isArray(raw)) {
    return { calendarEventId: null, minutesText: null, items: raw.filter(isAgendaItem) };
  }
  if (raw && typeof raw === "object") {
    const rec = raw as Record<string, unknown>;
    const calendarEventId =
      typeof rec.calendarEventId === "string" && isUuid(rec.calendarEventId) ? rec.calendarEventId : null;
    const trimmed = typeof rec.minutesText === "string" ? rec.minutesText.trim() : "";
    const items = Array.isArray(rec.items) ? rec.items.filter(isAgendaItem) : [];
    return { calendarEventId, minutesText: trimmed ? trimmed.slice(0, 20_000) : null, items };
  }
  return { calendarEventId: null, minutesText: null, items: [] };
}

export function encodeAgendaPayload(payload: AgendaPersistPayload): AgendaPersistPayload {
  const trimmed = payload.minutesText?.trim() ?? "";
  return {
    calendarEventId: payload.calendarEventId && isUuid(payload.calendarEventId) ? payload.calendarEventId : null,
    minutesText: trimmed ? trimmed.slice(0, 20_000) : null,
    items: payload.items.filter(isAgendaItem),
  };
}

/**
 * jsonb column shape: minutes + items only. The event id is written to
 * `meeting_autopilot_agendas.calendar_event_id`, not nested in agenda_items.
 */
export function encodeAgendaItemsColumn(payload: AgendaPersistPayload): {
  minutesText: string | null;
  items: AgendaItem[];
} {
  const encoded = encodeAgendaPayload(payload);
  return { minutesText: encoded.minutesText, items: encoded.items };
}

/** Prefer the dedicated column; fall back to a legacy jsonb calendarEventId. */
export function resolveCalendarEventId(
  columnValue: unknown,
  payload?: Pick<AgendaPersistPayload, "calendarEventId"> | null,
): string | null {
  if (typeof columnValue === "string" && isUuid(columnValue.trim())) return columnValue.trim();
  const fromPayload = payload?.calendarEventId;
  return fromPayload && isUuid(fromPayload) ? fromPayload : null;
}

export function attachMinutes(payload: AgendaPersistPayload, minutesText: string): AgendaPersistPayload {
  return encodeAgendaPayload({ ...payload, minutesText });
}

export type CalendarMeetingRef = {
  id: string;
  title: string;
  meetingOn: string;
};

export type AgendaLinkRef = {
  calendarEventId: string | null;
  title: string;
  meetingOn: string | null;
};

/**
 * Bind a persisted agenda to a calendar meeting. Prefer the stored event id;
 * fall back to a unique title+date match for legacy rows that only stored meeting_on.
 */
export function matchAgendaToMeeting(agenda: AgendaLinkRef, meetings: CalendarMeetingRef[]): string | null {
  if (agenda.calendarEventId && meetings.some((meeting) => meeting.id === agenda.calendarEventId)) {
    return agenda.calendarEventId;
  }
  const matches = meetings.filter(
    (meeting) => meeting.title === agenda.title && meeting.meetingOn === agenda.meetingOn,
  );
  return matches.length === 1 ? matches[0]!.id : null;
}

export function agendaForEvent<T extends { calendarEventId: string | null }>(
  agendas: T[],
  calendarEventId: string,
): T | null {
  return agendas.find((agenda) => agenda.calendarEventId === calendarEventId) ?? null;
}

export function meetingOnFromStartsAt(startsAt: string): string {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function utcYearFromStartsAt(startsAt: string): number | null {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.getUTCFullYear();
}

export function isEmptyUntilMeeting(meetings: readonly unknown[]): boolean {
  return meetings.length === 0;
}
