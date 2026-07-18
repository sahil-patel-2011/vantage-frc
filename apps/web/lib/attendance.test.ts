import { describe, expect, it } from "vitest";
import {
  defaultSeasonYear,
  parseAttendanceAction,
  personAttendanceBoard,
  summarizeAttendance,
  type AttendanceEvent,
} from "./attendance";

const ORG = "11111111-1111-4111-8111-111111111111";
const E1 = "44444444-4444-4444-8444-444444444444";

function event(overrides: Partial<AttendanceEvent> = {}): AttendanceEvent {
  return {
    id: E1,
    title: "Tuesday practice",
    kind: "practice",
    occurredOn: "2026-02-10",
    creditHours: 2,
    seasonYear: 2026,
    createdByName: "Lead",
    entries: [],
    ...overrides,
  };
}

describe("summarizeAttendance", () => {
  it("counts real entries only and uses credit hours when entry hours are null", () => {
    const summary = summarizeAttendance([
      event({
        entries: [
          {
            id: "a",
            eventId: E1,
            personName: "Ada",
            role: "student",
            hours: null,
            createdAt: "2026-02-10T22:00:00.000Z",
          },
          {
            id: "b",
            eventId: E1,
            personName: "Grace",
            role: "mentor",
            hours: 1.5,
            createdAt: "2026-02-10T22:00:00.000Z",
          },
        ],
      }),
    ]);
    expect(summary).toEqual({ eventCount: 1, entryCount: 2, uniquePeople: 2, totalHours: 3.5 });
  });

  it("stays empty with no marks", () => {
    expect(summarizeAttendance([event()])).toEqual({
      eventCount: 1,
      entryCount: 0,
      uniquePeople: 0,
      totalHours: 0,
    });
  });
});

describe("personAttendanceBoard", () => {
  it("merges case-insensitive names and ranks by event count", () => {
    const board = personAttendanceBoard([
      event({
        entries: [
          {
            id: "a",
            eventId: E1,
            personName: "Ada",
            role: "student",
            hours: 2,
            createdAt: "2026-02-10T22:00:00.000Z",
          },
        ],
      }),
      event({
        id: "e2",
        entries: [
          {
            id: "b",
            eventId: "e2",
            personName: "ada",
            role: "student",
            hours: 1,
            createdAt: "2026-02-12T22:00:00.000Z",
          },
          {
            id: "c",
            eventId: "e2",
            personName: "Grace",
            role: "mentor",
            hours: 1,
            createdAt: "2026-02-12T22:00:00.000Z",
          },
        ],
      }),
    ]);
    expect(board[0]).toMatchObject({ personName: "Ada", events: 2, totalHours: 3, studentEvents: 2 });
    expect(board[1]).toMatchObject({ personName: "Grace", events: 1, mentorEvents: 1 });
  });
});

describe("parseAttendanceAction", () => {
  it("parses create_event and add_entry", () => {
    expect(
      parseAttendanceAction({
        action: "create_event",
        orgId: ORG,
        title: " Friday build ",
        kind: "build",
        occurredOn: "2026-02-14",
        creditHours: 3,
        seasonYear: 2026,
      }),
    ).toMatchObject({ action: "create_event", title: "Friday build", kind: "build", creditHours: 3 });

    expect(
      parseAttendanceAction({
        action: "add_entry",
        orgId: ORG,
        eventId: E1,
        personName: "Ada Lovelace",
        role: "student",
        hours: "",
      }),
    ).toMatchObject({ action: "add_entry", personName: "Ada Lovelace", hours: null });
  });

  it("rejects bad kinds and hours", () => {
    expect(() =>
      parseAttendanceAction({
        action: "create_event",
        orgId: ORG,
        title: "X",
        kind: "party",
        occurredOn: "2026-02-14",
        seasonYear: 2026,
      }),
    ).toThrow(/kind/i);
    expect(() =>
      parseAttendanceAction({
        action: "add_entry",
        orgId: ORG,
        eventId: E1,
        personName: "Ada",
        hours: 40,
      }),
    ).toThrow(/Hours/);
  });
});

describe("defaultSeasonYear", () => {
  it("rolls to next year after August", () => {
    expect(defaultSeasonYear(new Date("2025-09-15T12:00:00Z"))).toBe(2026);
    expect(defaultSeasonYear(new Date("2026-02-01T12:00:00Z"))).toBe(2026);
  });
});
