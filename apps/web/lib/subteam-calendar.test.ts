import { describe, expect, it } from "vitest";
import {
  buildMonthCells,
  buildWeekCells,
  eventWorkflowLinks,
  eventsForMySubteams,
  filterEventsBySubteam,
  groupEventsByDay,
  localDayKey,
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
    myRsvp: null,
    rsvpGoing: 0,
    rsvpMaybe: 0,
    rsvpNo: 0,
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

  it("parses set_rsvp including clear (null)", () => {
    expect(
      parseSubteamCalendarAction({
        action: "set_rsvp",
        orgId: ORG,
        id: SUB_A,
        response: "going",
      }),
    ).toMatchObject({ action: "set_rsvp", response: "going" });
    expect(
      parseSubteamCalendarAction({
        action: "set_rsvp",
        orgId: ORG,
        id: SUB_A,
        response: null,
      }),
    ).toMatchObject({ response: null });
  });
});

describe("my-subteam strip + workflow deep links", () => {
  it("keeps whole-team rows and the member's subteams", () => {
    const events = [
      event({ id: "1", title: "All hands", startsAt: "2026-02-01T18:00:00.000Z", subteamId: null }),
      event({ id: "2", title: "Mech", startsAt: "2026-02-02T18:00:00.000Z", subteamId: SUB_A }),
      event({ id: "3", title: "Code", startsAt: "2026-02-03T18:00:00.000Z", subteamId: SUB_B }),
    ];
    expect(eventsForMySubteams(events, [SUB_A]).map((e) => e.id)).toEqual(["1", "2"]);
    expect(eventsForMySubteams(events, []).map((e) => e.id)).toEqual(["1"]);
  });

  it("maps kinds to practice / Event Day / scouting / business", () => {
    const practice = eventWorkflowLinks(
      event({ id: "p", title: "P", startsAt: "2026-02-01T18:00:00.000Z", kind: "practice" }),
      ORG,
    );
    expect(practice.some((l) => l.href.includes("/practice"))).toBe(true);

    const competition = eventWorkflowLinks(
      event({ id: "e", title: "E", startsAt: "2026-02-01T18:00:00.000Z", kind: "event" }),
      ORG,
    );
    expect(competition.map((l) => l.label)).toEqual(
      expect.arrayContaining(["Event Day Command", "Scouting duty"]),
    );

    const deadline = eventWorkflowLinks(
      event({ id: "d", title: "D", startsAt: "2026-02-01T18:00:00.000Z", kind: "deadline" }),
      ORG,
    );
    expect(deadline.some((l) => l.href.includes("/business"))).toBe(true);

    const discuss = eventWorkflowLinks(
      event({ id: "c", title: "Shop night", startsAt: "2026-02-01T18:00:00.000Z", kind: "build" }),
      ORG,
    );
    expect(discuss.some((l) => l.label === "Discuss in Messages" && l.href.includes("linkType=event"))).toBe(true);

    const outreach = eventWorkflowLinks(
      event({ id: "o", title: "Partner night", startsAt: "2026-02-01T18:00:00.000Z", kind: "outreach" }),
      ORG,
    );
    expect(outreach.some((l) => l.href.includes("/visit-invites"))).toBe(true);
    expect(outreach.some((l) => l.label === "Visit invites")).toBe(true);
  });
});

describe("week / month grids", () => {
  it("builds a 7-day week and 42-cell month", () => {
    const anchor = new Date(2026, 2, 11); // Wed Mar 11 2026
    const today = new Date(2026, 2, 11);
    const events = [
      event({
        id: "1",
        title: "Shop",
        startsAt: new Date(2026, 2, 11, 16, 0).toISOString(),
      }),
    ];
    const week = buildWeekCells(anchor, events, today);
    expect(week).toHaveLength(7);
    expect(week[0]!.day).toBe(localDayKey(new Date(2026, 2, 8))); // Sunday
    expect(week.find((c) => c.isToday)?.items.map((i) => i.id)).toEqual(["1"]);

    const month = buildMonthCells(anchor, events, today);
    expect(month).toHaveLength(42);
    expect(month.filter((c) => c.inMonth).length).toBeGreaterThanOrEqual(28);
  });
});
