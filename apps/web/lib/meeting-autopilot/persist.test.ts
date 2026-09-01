import { describe, expect, it } from "vitest";
import {
  agendaForEvent,
  attachMinutes,
  decodeAgendaPayload,
  encodeAgendaItemsColumn,
  encodeAgendaPayload,
  isEmptyUntilMeeting,
  isUuid,
  matchAgendaToMeeting,
  meetingOnFromStartsAt,
  requireCalendarEventId,
  resolveCalendarEventId,
  utcYearFromStartsAt,
} from "./persist";
import type { AgendaItem } from "./types";

const EVENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const item: AgendaItem = {
  kind: "blocker",
  sourceId: "b1",
  title: "Waiting on vendor belt",
  detail: "Intake — Awaiting supplier shipment",
  weight: 1020,
};

describe("requireCalendarEventId", () => {
  it("accepts a uuid and rejects anything else", () => {
    expect(requireCalendarEventId(` ${EVENT} `)).toBe(EVENT);
    expect(() => requireCalendarEventId(null)).toThrow(/calendarEventId is required/);
    expect(() => requireCalendarEventId("weekly-sync")).toThrow(/calendarEventId is required/);
    expect(() => requireCalendarEventId("")).toThrow(/calendarEventId is required/);
  });
});

describe("agenda payload", () => {
  it("round-trips calendar event id + minutes + items", () => {
    const encoded = encodeAgendaPayload({
      calendarEventId: EVENT,
      minutesText: "  - Order belt @Alex due 2026-07-25  ",
      items: [item],
    });
    expect(encoded.calendarEventId).toBe(EVENT);
    expect(encoded.minutesText).toBe("- Order belt @Alex due 2026-07-25");
    expect(encoded.items).toEqual([item]);
    expect(decodeAgendaPayload(encoded)).toEqual(encoded);
  });

  it("decodes a legacy bare array without inventing minutes or an event id", () => {
    const decoded = decodeAgendaPayload([item, { not: "an-item" }]);
    expect(decoded.calendarEventId).toBeNull();
    expect(decoded.minutesText).toBeNull();
    expect(decoded.items).toEqual([item]);
  });

  it("treats missing or blank minutes as null — never a DEMO string", () => {
    expect(decodeAgendaPayload({ calendarEventId: EVENT, items: [item] }).minutesText).toBeNull();
    expect(decodeAgendaPayload({ calendarEventId: EVENT, minutesText: "   ", items: [] }).minutesText).toBeNull();
    expect(encodeAgendaPayload({ calendarEventId: EVENT, minutesText: "", items: [] }).minutesText).toBeNull();
    const empty = decodeAgendaPayload(null);
    expect(empty.minutesText).toBeNull();
    expect(empty.items).toEqual([]);
    expect(JSON.stringify(empty)).not.toMatch(/DEMO/i);
  });

  it("drops junk calendar ids instead of persisting them", () => {
    expect(encodeAgendaPayload({ calendarEventId: "not-a-uuid", minutesText: null, items: [] }).calendarEventId).toBeNull();
    expect(isUuid(EVENT)).toBe(true);
    expect(isUuid("meeting-1")).toBe(false);
  });

  it("writes minutes + items to jsonb without embedding the calendar event id", () => {
    const column = encodeAgendaItemsColumn({
      calendarEventId: EVENT,
      minutesText: "  - Order belt  ",
      items: [item],
    });
    expect(column).toEqual({ minutesText: "- Order belt", items: [item] });
    expect(column).not.toHaveProperty("calendarEventId");
    expect(JSON.stringify(column)).not.toMatch(/DEMO/i);
    expect(JSON.stringify(column)).not.toContain(EVENT);
  });
});

describe("resolveCalendarEventId", () => {
  it("prefers the dedicated column over a legacy jsonb id", () => {
    expect(resolveCalendarEventId(EVENT, { calendarEventId: OTHER })).toBe(EVENT);
    expect(resolveCalendarEventId(` ${EVENT} `, { calendarEventId: null })).toBe(EVENT);
    expect(resolveCalendarEventId(null, { calendarEventId: EVENT })).toBe(EVENT);
    expect(resolveCalendarEventId("not-a-uuid", { calendarEventId: EVENT })).toBe(EVENT);
    expect(resolveCalendarEventId(null, { calendarEventId: null })).toBeNull();
    expect(resolveCalendarEventId(undefined, undefined)).toBeNull();
  });
});

describe("attachMinutes", () => {
  it("writes minutes onto an existing payload without inventing agenda items", () => {
    const next = attachMinutes({ calendarEventId: EVENT, minutesText: null, items: [item] }, "TODO: Finish wiring");
    expect(next.minutesText).toBe("TODO: Finish wiring");
    expect(next.items).toEqual([item]);
    expect(next.calendarEventId).toBe(EVENT);
  });

  it("clears minutes back to null rather than leaving a placeholder", () => {
    const next = attachMinutes(
      { calendarEventId: EVENT, minutesText: "old notes", items: [] },
      "   ",
    );
    expect(next.minutesText).toBeNull();
  });
});

describe("matchAgendaToMeeting", () => {
  const meetings = [
    { id: EVENT, title: "Weekly build sync", meetingOn: "2026-07-18" },
    { id: OTHER, title: "Design review", meetingOn: "2026-07-20" },
  ];

  it("prefers the stored calendar event id", () => {
    expect(
      matchAgendaToMeeting({ calendarEventId: OTHER, title: "Weekly build sync", meetingOn: "2026-07-18" }, meetings),
    ).toBe(OTHER);
  });

  it("falls back to a unique title+date match for legacy rows", () => {
    expect(
      matchAgendaToMeeting({ calendarEventId: null, title: "Weekly build sync", meetingOn: "2026-07-18" }, meetings),
    ).toBe(EVENT);
  });

  it("does not guess when title+date is ambiguous", () => {
    const dupes = [
      { id: EVENT, title: "Standup", meetingOn: "2026-07-18" },
      { id: OTHER, title: "Standup", meetingOn: "2026-07-18" },
    ];
    expect(matchAgendaToMeeting({ calendarEventId: null, title: "Standup", meetingOn: "2026-07-18" }, dupes)).toBeNull();
  });
});

describe("agendaForEvent / empty-until-meeting", () => {
  it("returns the agenda persisted against that event and nothing else", () => {
    const agendas = [
      { id: "a1", calendarEventId: EVENT },
      { id: "a2", calendarEventId: OTHER },
    ];
    expect(agendaForEvent(agendas, EVENT)?.id).toBe("a1");
    expect(agendaForEvent(agendas, "dddddddd-dddd-4ddd-8ddd-dddddddddddd")).toBeNull();
  });

  it("is empty until a meeting exists", () => {
    expect(isEmptyUntilMeeting([])).toBe(true);
    expect(isEmptyUntilMeeting([{ id: EVENT }])).toBe(false);
  });
});

describe("meeting date helpers", () => {
  it("derives the UTC meeting date and season year from starts_at", () => {
    expect(meetingOnFromStartsAt("2026-07-18T22:30:00.000Z")).toBe("2026-07-18");
    expect(utcYearFromStartsAt("2026-07-18T22:30:00.000Z")).toBe(2026);
    expect(meetingOnFromStartsAt("not-a-date")).toBe("");
    expect(utcYearFromStartsAt("not-a-date")).toBeNull();
  });
});
