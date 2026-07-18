import { describe, expect, it } from "vitest";
import {
  buildCalendar,
  escapeText,
  formatDateValue,
  formatUtc,
  googleCalendarSubscribeUrl,
  toWebcalUrl,
  type CalendarIcsEvent,
} from "./calendar-ics";

function event(overrides: Partial<CalendarIcsEvent>): CalendarIcsEvent {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "Build night",
    kind: "build",
    location: "Shop",
    description: "Assemble intake",
    startsAt: "2026-03-10T23:00:00.000Z",
    endsAt: "2026-03-11T01:00:00.000Z",
    updatedAt: "2026-03-01T12:00:00.000Z",
    allDay: false,
    ...overrides,
  };
}

describe("formatUtc", () => {
  it("renders a UTC iCal stamp", () => {
    expect(formatUtc("2026-03-10T23:05:09.000Z")).toBe("20260310T230509Z");
  });
  it("returns null for garbage", () => {
    expect(formatUtc("not-a-date")).toBeNull();
  });
});

describe("formatDateValue", () => {
  it("strips hyphens from a calendar date", () => {
    expect(formatDateValue("2026-01-03")).toBe("20260103");
  });
  it("accepts an ISO prefix", () => {
    expect(formatDateValue("2026-01-03T00:00:00.000Z")).toBe("20260103");
  });
});

describe("escapeText", () => {
  it("escapes commas, semicolons, backslashes and newlines", () => {
    expect(escapeText("a, b; c\\d\ne")).toBe("a\\, b\\; c\\\\d\\ne");
  });
});

describe("buildCalendar", () => {
  it("emits a well-formed VCALENDAR with one VEVENT per timed event", () => {
    const ics = buildCalendar(
      { orgName: "Robo", teamNumber: 1234, scope: "personal", events: [event({})] },
      { domain: "vantagefrc.com" },
    );
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
    expect(ics).toContain("UID:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa@vantagefrc.com");
    expect(ics).toContain("DTSTART:20260310T230000Z");
    expect(ics).toContain("DTEND:20260311T010000Z");
    expect(ics).toContain("SUMMARY:Build night");
    expect(ics).toContain("X-WR-CALNAME:Team 1234 — Vantage (personal)");
    expect(ics).toContain("X-WR-TIMEZONE:UTC");
    expect(ics).toContain("CATEGORIES:BUILD");
  });

  it("emits floating DATE values for all-day milestones", () => {
    const ics = buildCalendar(
      {
        orgName: null,
        teamNumber: null,
        events: [
          event({
            id: "mile",
            title: "Kickoff",
            kind: "kickoff",
            startsAt: "2026-01-03",
            endsAt: "2026-01-03",
            allDay: true,
            location: "",
            description: "",
          }),
        ],
      },
      { domain: "x" },
    );
    expect(ics).toContain("DTSTART;VALUE=DATE:20260103");
    // Exclusive end = day after last inclusive day
    expect(ics).toContain("DTEND;VALUE=DATE:20260104");
    expect(ics).not.toContain("DTSTART:20260103");
  });

  it("defaults a missing end time to one hour after start", () => {
    const ics = buildCalendar(
      { orgName: null, teamNumber: null, events: [event({ endsAt: null })] },
      { domain: "x" },
    );
    expect(ics).toContain("DTSTART:20260310T230000Z");
    expect(ics).toContain("DTEND:20260311T000000Z");
  });

  it("skips events with an unparseable start", () => {
    const ics = buildCalendar(
      { orgName: null, teamNumber: null, events: [event({ startsAt: "nope" }), event({ id: "keep" })] },
      { domain: "x" },
    );
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
    expect(ics).toContain("UID:keep@x");
  });

  it("escapes user text so a comma cannot break the line", () => {
    const ics = buildCalendar(
      {
        orgName: null,
        teamNumber: null,
        events: [event({ title: "Scrimmage, then debrief", location: "Room A; B" })],
      },
      { domain: "x" },
    );
    expect(ics).toContain("SUMMARY:Scrimmage\\, then debrief");
    expect(ics).toContain("LOCATION:Room A\\; B");
  });
});

describe("subscribe helpers", () => {
  it("builds Apple webcal and Google cid URLs", () => {
    const https = "https://app.example/api/calendar/feed/abc123";
    expect(toWebcalUrl(https)).toBe("webcal://app.example/api/calendar/feed/abc123");
    expect(googleCalendarSubscribeUrl(https)).toContain(
      encodeURIComponent("webcal://app.example/api/calendar/feed/abc123"),
    );
  });
});
