import { describe, expect, it } from "vitest";
import {
  filterEventsBySubteam,
  groupEventsByDay,
  parseSubteamCalendarAction,
  sortEvents,
  upcomingEvents,
  type CalendarEvent,
} from "./subteam-calendar";

const ORG = "11111111-1111-4111-8111-111111111111";
const SUB_A = "22222222-2222-4222-8222-222222222222";
const SUB_B = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

function event(partial: Partial<CalendarEvent> & Pick<CalendarEvent, "id" | "title" | "startsAt">): CalendarEvent {
  return {
    kind: "practice",
    endsAt: null,
    location: "",
    notes: "",
    subteamId: null,
    subteamName: null,
    subteamColor: null,
    attendanceEventId: null,
    attendanceEventTitle: null,
    milestoneId: null,
    driverSessionId: null,
    createdByName: null,
    ...partial,
  };
}

describe("filterEventsBySubteam", () => {
  const events = [
    event({ id: "1", title: "Whole team", startsAt: "2026-02-01T18:00:00.000Z", subteamId: null }),
    event({ id: "2", title: "Mech build", startsAt: "2026-02-02T18:00:00.000Z", subteamId: SUB_A }),
    event({ id: "3", title: "Code review", startsAt: "2026-02-03T18:00:00.000Z", subteamId: SUB_B }),
  ];

  it("returns all events for the combined team view", () => {
    expect(filterEventsBySubteam(events, null)).toHaveLength(3);
  });

  it("includes whole-team rows when filtering to a subteam", () => {
    const filtered = filterEventsBySubteam(events, SUB_A);
    expect(filtered.map((e) => e.id)).toEqual(["1", "2"]);
  });
});

describe("groupEventsByDay / upcoming", () => {
  it("groups and sorts by day", () => {
    const buckets = groupEventsByDay([
      event({ id: "b", title: "B", startsAt: "2026-03-02T20:00:00.000Z" }),
      event({ id: "a", title: "A", startsAt: "2026-03-02T18:00:00.000Z" }),
      event({ id: "c", title: "C", startsAt: "2026-03-01T18:00:00.000Z" }),
    ]);
    expect(buckets.map((b) => b.day)).toEqual(["2026-03-01", "2026-03-02"]);
    expect(buckets[1]!.items.map((i) => i.title)).toEqual(["A", "B"]);
  });

  it("lists upcoming soonest-first", () => {
    const now = new Date("2026-03-01T12:00:00.000Z");
    const list = upcomingEvents(
      [
        event({ id: "past", title: "Past", startsAt: "2026-02-01T18:00:00.000Z" }),
        event({ id: "soon", title: "Soon", startsAt: "2026-03-02T18:00:00.000Z" }),
        event({ id: "later", title: "Later", startsAt: "2026-03-10T18:00:00.000Z" }),
      ],
      now,
      5,
    );
    expect(list.map((e) => e.id)).toEqual(["soon", "later"]);
  });

  it("sortEvents is stable by start then title", () => {
    const sorted = sortEvents([
      event({ id: "2", title: "B", startsAt: "2026-01-01T10:00:00.000Z" }),
      event({ id: "1", title: "A", startsAt: "2026-01-01T10:00:00.000Z" }),
    ]);
    expect(sorted.map((e) => e.title)).toEqual(["A", "B"]);
  });
});

describe("parseSubteamCalendarAction", () => {
  it("creates a subteam with hex color", () => {
    expect(
      parseSubteamCalendarAction({
        action: "create_subteam",
        orgId: ORG,
        name: "Mechanical",
        color: "#2D6A4F",
      }),
    ).toMatchObject({ name: "Mechanical", color: "#2d6a4f" });
  });

  it("rejects invalid colors and kinds", () => {
    expect(() =>
      parseSubteamCalendarAction({ action: "create_subteam", orgId: ORG, name: "X", color: "blue" }),
    ).toThrow(/#RRGGBB/);
    expect(() =>
      parseSubteamCalendarAction({
        action: "create_event",
        orgId: ORG,
        title: "Practice",
        kind: "demo",
        startsAt: "2026-02-01T18:00:00.000Z",
      }),
    ).toThrow(/Kind/);
  });

  it("parses create_event with optional attendance link/create flag", () => {
    const parsed = parseSubteamCalendarAction({
      action: "create_event",
      orgId: ORG,
      title: "Drive practice",
      kind: "practice",
      startsAt: "2026-02-10T23:00:00.000Z",
      subteamId: SUB_A,
      createAttendance: true,
      attendanceCreditHours: 2.5,
    });
    expect(parsed).toMatchObject({
      action: "create_event",
      title: "Drive practice",
      subteamId: SUB_A,
      createAttendance: true,
      attendanceCreditHours: 2.5,
    });
  });

  it("assigns member subteams as a unique uuid list", () => {
    const parsed = parseSubteamCalendarAction({
      action: "set_member_subteams",
      orgId: ORG,
      userId: USER,
      subteamIds: [SUB_A, SUB_A, SUB_B],
    });
    expect(parsed).toMatchObject({ subteamIds: [SUB_A, SUB_B] });
  });

  it("requires end >= start on create and update", () => {
    expect(() =>
      parseSubteamCalendarAction({
        action: "create_event",
        orgId: ORG,
        title: "Bad",
        kind: "build",
        startsAt: "2026-02-10T20:00:00.000Z",
        endsAt: "2026-02-10T19:00:00.000Z",
      }),
    ).toThrow(/End/);
  });
});
