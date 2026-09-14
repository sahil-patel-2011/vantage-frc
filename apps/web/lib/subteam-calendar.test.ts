import { describe, expect, it } from "vitest";
import {
  allianceTeamKeys,
  buildDayCells,
  buildMonthCells,
  buildWeekCells,
  eventWorkflowLinks,
  eventsForMySubteams,
  filterEventsBySubteam,
  githubItemsToIcsEvents,
  groupEventsByDay,
  isReadonlyCalendarEvent,
  layoutTimedEventsForDay,
  localDayKey,
  overlayItemsForDay,
  parseSubteamCalendarAction,
  shiftAnchor,
  sortEvents,
  tbaMatchesToCalendarEvents,
  tbaMatchTitle,
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
  it("groups and sorts by local day (matches month/week grids)", () => {
    const buckets = groupEventsByDay([
      event({ id: "b", title: "B", startsAt: new Date(2026, 2, 2, 15, 0).toISOString() }),
      event({ id: "a", title: "A", startsAt: new Date(2026, 2, 2, 13, 0).toISOString() }),
      event({ id: "c", title: "C", startsAt: new Date(2026, 2, 1, 13, 0).toISOString() }),
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
      expect.arrayContaining(["Event day", "Scouting duty"]),
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

  it("builds a single-day cell and shifts the day anchor", () => {
    const anchor = new Date(2026, 2, 11);
    const today = new Date(2026, 2, 11);
    const events = [
      event({
        id: "1",
        title: "Shop",
        startsAt: new Date(2026, 2, 11, 16, 0).toISOString(),
      }),
    ];
    const day = buildDayCells(anchor, events, today);
    expect(day).toHaveLength(1);
    expect(day[0]!.day).toBe(localDayKey(anchor));
    expect(day[0]!.items.map((item) => item.id)).toEqual(["1"]);
    expect(localDayKey(shiftAnchor(anchor, "day", 1))).toBe(localDayKey(new Date(2026, 2, 12)));
  });
});

describe("timed grid + GitHub overlay", () => {
  it("lays out timed events and excludes all-day midnight rows", () => {
    const timed = event({
      id: "shop",
      title: "Shop",
      startsAt: new Date(2026, 2, 11, 16, 0).toISOString(),
      endsAt: new Date(2026, 2, 11, 18, 0).toISOString(),
    });
    const overlap = event({
      id: "code",
      title: "Code",
      startsAt: new Date(2026, 2, 11, 16, 30).toISOString(),
      endsAt: new Date(2026, 2, 11, 17, 30).toISOString(),
    });
    const allDay = event({
      id: "bag",
      title: "Bag day",
      startsAt: new Date(2026, 2, 11, 0, 0).toISOString(),
      endsAt: null,
    });
    const blocks = layoutTimedEventsForDay([timed, overlap, allDay]);
    expect(blocks.map((block) => block.event.id)).toEqual(["shop", "code"]);
    expect(blocks[0]!.cols).toBe(2);
    expect(blocks[1]!.col).toBeGreaterThanOrEqual(0);
  });

  it("keeps GitHub overlay items on their real due date only", () => {
    const items = [
      { id: "ms-1", title: "Stop build", dueOn: "2026-02-18", href: "https://github.com/org/repo/milestone/1", source: "github" as const },
      { id: "ms-2", title: "Ship", dueOn: "2026-02-20", href: "https://github.com/org/repo/milestone/2", source: "github" as const },
    ];
    expect(overlayItemsForDay(items, "2026-02-18").map((item) => item.id)).toEqual(["ms-1"]);
    expect(overlayItemsForDay(items, "2026-02-19")).toEqual([]);
    expect(overlayItemsForDay(undefined, "2026-02-18")).toEqual([]);
  });
});

describe("TBA match calendar overlay", () => {
  const row = {
    matchKey: "2026nhdur_qm12",
    compLevel: "qm",
    matchNumber: 12,
    scheduledTime: "2026-03-14T15:10:00.000Z",
    redAlliance: { teamKeys: ["frc3467", "frc123", "frc1"] },
    blueAlliance: { teamKeys: ["frc254", "frc1678", "frc118"] },
    eventName: "Week 1",
  };

  it("places this team on the timed grid with bumper color from the alliance list", () => {
    const events = tbaMatchesToCalendarEvents([row], "frc123");
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe("match-2026nhdur_qm12");
    expect(events[0]!.title).toBe(tbaMatchTitle("qm", 12, "red"));
    expect(events[0]!.source).toBe("tba");
    expect(events[0]!.bumper).toBe("red");
    expect(events[0]!.notes).toBe("RED bumpers");
    expect(events[0]!.location).toBe("Week 1");
    expect(isReadonlyCalendarEvent(events[0]!)).toBe(true);
  });

  it("skips matches without a real time and matches this team is not on", () => {
    expect(
      tbaMatchesToCalendarEvents(
        [
          { ...row, scheduledTime: null },
          { ...row, matchKey: "other", redAlliance: { teamKeys: ["frc9"] }, blueAlliance: { team_keys: ["frc8"] } },
          { ...row, scheduledTime: "not-a-time" },
        ],
        "frc123",
      ),
    ).toEqual([]);
    expect(tbaMatchesToCalendarEvents([row], "")).toEqual([]);
  });

  it("reads snake_case team_keys from alliance JSON", () => {
    const events = tbaMatchesToCalendarEvents(
      [
        {
          ...row,
          redAlliance: { team_keys: ["frc1"] },
          blueAlliance: { team_keys: ["frc123"] },
        },
      ],
      "frc123",
    );
    expect(events[0]!.bumper).toBe("blue");
    expect(allianceTeamKeys({ team_keys: ["frc123"] })).toEqual(["frc123"]);
  });
});

describe("githubItemsToIcsEvents", () => {
  it("emits all-day rows only for items with a due date", () => {
    const ics = githubItemsToIcsEvents([
      { id: "ms-4", title: "Stop build", dueOn: "2026-02-18", href: "https://github.com/org/robot/milestone/4", source: "github" },
    ]);
    expect(ics).toEqual([
      {
        id: "github-ms-4",
        title: "GitHub · Stop build",
        kind: "deadline",
        location: "",
        description: "https://github.com/org/robot/milestone/4",
        startsAt: "2026-02-18",
        endsAt: "2026-02-18",
        updatedAt: "2026-02-18T00:00:00.000Z",
        allDay: true,
      },
    ]);
    expect(githubItemsToIcsEvents(undefined)).toEqual([]);
  });
});
