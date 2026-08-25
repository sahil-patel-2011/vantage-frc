import { describe, expect, it } from "vitest";
import {
  buildRecurringCalendar,
  buildVTimeZone,
  findZoneTransitions,
  formatUtcOffset,
  localStampIn,
  type RecurringIcsEvent,
} from "./ics-recurrence";

const NOW = new Date("2026-01-05T00:00:00.000Z");
const NY = "America/New_York";

function baseEvent(overrides: Partial<RecurringIcsEvent> = {}): RecurringIcsEvent {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Build night",
    kind: "build",
    location: "Shop",
    description: "",
    // 2026-01-13 18:00 America/New_York (EST, UTC-5)
    startsAt: "2026-01-13T23:00:00.000Z",
    endsAt: "2026-01-14T02:00:00.000Z",
    updatedAt: "2026-01-05T00:00:00.000Z",
    allDay: false,
    ...overrides,
  };
}

function lines(ics: string): string[] {
  // Unfold before asserting so a folded long line still matches.
  return ics.replace(/\r\n[ \t]/g, "").split("\r\n");
}

describe("formatUtcOffset", () => {
  it("formats whole and negative offsets", () => {
    expect(formatUtcOffset(0)).toBe("+0000");
    expect(formatUtcOffset(-5 * 3600_000)).toBe("-0500");
    expect(formatUtcOffset(-4 * 3600_000)).toBe("-0400");
    expect(formatUtcOffset(5.5 * 3600_000)).toBe("+0530");
  });
});

describe("localStampIn", () => {
  it("renders the wall clock, not UTC", () => {
    expect(localStampIn("2026-01-13T23:00:00.000Z", NY)).toBe("20260113T180000");
    // Same 6pm local, but after the March change the UTC instant is an hour earlier.
    expect(localStampIn("2026-03-17T22:00:00.000Z", NY)).toBe("20260317T180000");
  });

  it("returns null for junk", () => {
    expect(localStampIn("not-a-date", NY)).toBeNull();
  });
});

describe("findZoneTransitions", () => {
  it("finds both US transitions in a year", () => {
    const found = findZoneTransitions(
      NY,
      Date.UTC(2026, 0, 1),
      Date.UTC(2026, 11, 31),
    );
    expect(found).toHaveLength(2);
    expect(found[0]!.daylight).toBe(true);
    expect(found[0]!.offsetFromMs).toBe(-5 * 3600_000);
    expect(found[0]!.offsetToMs).toBe(-4 * 3600_000);
    // 2026-03-08 02:00 local = 07:00 UTC
    expect(new Date(found[0]!.atMs).toISOString()).toBe("2026-03-08T07:00:00.000Z");
    expect(found[1]!.daylight).toBe(false);
    expect(new Date(found[1]!.atMs).toISOString()).toBe("2026-11-01T06:00:00.000Z");
  });

  it("returns nothing for a fixed-offset zone", () => {
    expect(findZoneTransitions("UTC", Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31))).toEqual([]);
    expect(
      findZoneTransitions("America/Phoenix", Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31)),
    ).toEqual([]);
  });
});

describe("buildVTimeZone", () => {
  it("emits STANDARD and DAYLIGHT onsets in the previous offset's wall clock", () => {
    const block = buildVTimeZone(NY, Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31));
    expect(block).not.toBeNull();
    const text = block!.join("\n");
    expect(text).toContain("TZID:America/New_York");
    expect(text).toContain("BEGIN:DAYLIGHT");
    expect(text).toContain("BEGIN:STANDARD");
    // Spring forward: 02:00 EST -> 03:00 EDT, so DTSTART is the 02:00 local onset.
    expect(text).toContain("DTSTART:20260308T020000");
    expect(text).toContain("TZOFFSETFROM:-0500");
    expect(text).toContain("TZOFFSETTO:-0400");
    // Fall back: 02:00 EDT -> 01:00 EST.
    expect(text).toContain("DTSTART:20261101T020000");
  });

  it("gives a fixed zone a single STANDARD component", () => {
    const block = buildVTimeZone("America/Phoenix", Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31));
    const text = block!.join("\n");
    expect(text).toContain("TZOFFSETFROM:-0700");
    expect(text).toContain("TZOFFSETTO:-0700");
    expect(text).not.toContain("BEGIN:DAYLIGHT");
  });

  it("returns null for UTC (plain Z stamps are used instead)", () => {
    expect(buildVTimeZone("UTC", Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31))).toBeNull();
  });
});

describe("buildRecurringCalendar", () => {
  it("emits one VEVENT with an RRULE instead of expanded copies", () => {
    const ics = buildRecurringCalendar(
      {
        orgName: "Team",
        teamNumber: 254,
        scope: "org",
        events: [
          baseEvent({
            rrule: "FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20260220T045959Z",
            timeZone: NY,
          }),
        ],
      },
      { domain: "vantagefrc.com", now: NOW },
    );
    const out = lines(ics);
    expect(out.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
    expect(out).toContain("DTSTART;TZID=America/New_York:20260113T180000");
    expect(out).toContain("DTEND;TZID=America/New_York:20260113T210000");
    expect(out).toContain("RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20260220T045959Z");
    expect(out).toContain("BEGIN:VTIMEZONE");
    expect(out).toContain("TZID:America/New_York");
  });

  it("emits EXDATE for skipped occurrences in the series zone", () => {
    const ics = buildRecurringCalendar(
      {
        orgName: "Team",
        teamNumber: 254,
        events: [
          baseEvent({
            rrule: "FREQ=WEEKLY;BYDAY=TU",
            timeZone: NY,
            // Thanksgiving week — still 6pm local even though it is EST by then.
            exdates: ["2026-11-24T23:00:00.000Z"],
          }),
        ],
      },
      { domain: "vantagefrc.com", now: NOW },
    );
    expect(lines(ics)).toContain("EXDATE;TZID=America/New_York:20261124T180000");
  });

  it("pairs a detached occurrence to its series with a shared UID + RECURRENCE-ID", () => {
    const ics = buildRecurringCalendar(
      {
        orgName: "Team",
        teamNumber: 254,
        events: [
          baseEvent({
            rrule: "FREQ=WEEKLY;BYDAY=TU",
            timeZone: NY,
            exdates: ["2026-01-20T23:00:00.000Z"],
          }),
          baseEvent({
            id: "22222222-2222-4222-8222-222222222222",
            title: "Build night (starts at 5)",
            startsAt: "2026-01-20T22:00:00.000Z",
            endsAt: "2026-01-21T02:00:00.000Z",
            seriesUid: "11111111-1111-4111-8111-111111111111",
            recurrenceId: "2026-01-20T23:00:00.000Z",
            timeZone: NY,
          }),
        ],
      },
      { domain: "vantagefrc.com", now: NOW },
    );
    const out = lines(ics);
    expect(out.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(2);
    // Both VEVENTs carry the master UID — that is what makes it an override.
    expect(
      out.filter((line) => line === "UID:11111111-1111-4111-8111-111111111111@vantagefrc.com"),
    ).toHaveLength(2);
    expect(out).toContain("RECURRENCE-ID;TZID=America/New_York:20260120T180000");
    expect(out).toContain("DTSTART;TZID=America/New_York:20260120T170000");
  });

  it("leaves non-recurring rows as plain UTC stamps with their own UID", () => {
    const ics = buildRecurringCalendar(
      { orgName: "Team", teamNumber: null, events: [baseEvent()] },
      { domain: "vantagefrc.com", now: NOW },
    );
    const out = lines(ics);
    expect(out).toContain("DTSTART:20260113T230000Z");
    expect(out).toContain("UID:11111111-1111-4111-8111-111111111111@vantagefrc.com");
    expect(out).not.toContain("BEGIN:VTIMEZONE");
    expect(out.some((line) => line.startsWith("RRULE"))).toBe(false);
  });

  it("ignores an unparseable rule rather than emitting a rule clients cannot read", () => {
    const ics = buildRecurringCalendar(
      {
        orgName: "Team",
        teamNumber: null,
        events: [baseEvent({ rrule: "FREQ=HOURLY;BYSETPOS=2", timeZone: NY })],
      },
      { domain: "vantagefrc.com", now: NOW },
    );
    const out = lines(ics);
    expect(out.some((line) => line.startsWith("RRULE"))).toBe(false);
    expect(out).toContain("DTSTART:20260113T230000Z");
  });

  it("escapes text and keeps all-day milestones as floating DATE values", () => {
    const ics = buildRecurringCalendar(
      {
        orgName: "Team",
        teamNumber: null,
        events: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            title: "Kickoff; bring, notes",
            kind: "deadline",
            location: "",
            description: "",
            startsAt: "2026-01-03",
            endsAt: "2026-01-03",
            updatedAt: "2026-01-01T00:00:00.000Z",
            allDay: true,
          },
        ],
      },
      { domain: "vantagefrc.com", now: NOW },
    );
    const out = lines(ics);
    expect(out).toContain("DTSTART;VALUE=DATE:20260103");
    expect(out).toContain("DTEND;VALUE=DATE:20260104");
    expect(out).toContain("SUMMARY:Kickoff\\; bring\\, notes");
  });

  it("produces CRLF line endings and a closed VCALENDAR", () => {
    const ics = buildRecurringCalendar(
      { orgName: "Team", teamNumber: null, events: [baseEvent()] },
      { domain: "vantagefrc.com", now: NOW },
    );
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
