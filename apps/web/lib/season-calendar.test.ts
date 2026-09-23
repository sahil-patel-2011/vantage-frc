import { describe, expect, it } from "vitest";
import {
  applyCalendarLocalWrite,
  daysUntil,
  getSeasonTemplate,
  groupByMonth,
  isCalendarQueueableAction,
  listSeasonTemplates,
  meetingProvider,
  milestoneWorkflowLinks,
  milestonesInMonth,
  nextUpcoming,
  optionalMeetingUrl,
  parseCalendarAction,
  SEASON_TEMPLATE,
  SEASON_TEMPLATES,
  canDeleteSeasonMilestone,
  seasonProgress,
  seedFromKickoff,
  type CalendarView,
  type Milestone,
} from "./season-calendar";

const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

// Fixed "now": midday on the 2027 kickoff Saturday.
const NOW = new Date("2027-01-09T12:00:00");

function milestone(overrides: Partial<Milestone>): Milestone {
  return {
    id: "m1",
    title: "Drivetrain rolling",
    kind: "build",
    startsOn: "2027-01-30",
    endsOn: null,
    notes: "",
    meetingUrl: null,
    done: false,
    doneAt: null,
    doneByName: null,
    createdByName: null,
    ...overrides,
  };
}

describe("canDeleteSeasonMilestone", () => {
  it("lets the author and an owner or admin delete, and keeps other members out", () => {
    expect(canDeleteSeasonMilestone({ role: "scout", userId: "noah", authorId: "noah" })).toBe(true);
    expect(canDeleteSeasonMilestone({ role: "scout", userId: "noah", authorId: "ada" })).toBe(false);
    expect(canDeleteSeasonMilestone({ role: "owner", userId: "ada", authorId: "noah" })).toBe(true);
    expect(canDeleteSeasonMilestone({ role: null, userId: null, authorId: "noah" })).toBe(false);
  });
});

describe("meeting links", () => {
  it("validates https meeting URLs and rejects junk", () => {
    expect(optionalMeetingUrl("https://zoom.us/j/123456")).toBe("https://zoom.us/j/123456");
    expect(optionalMeetingUrl("")).toBeNull();
    expect(optionalMeetingUrl(null)).toBeNull();
    expect(() => optionalMeetingUrl("http://zoom.us/j/1")).toThrow(/https/);
    expect(() => optionalMeetingUrl("not a url")).toThrow(/https/);
    expect(() => optionalMeetingUrl("https://localhost/x")).toThrow(/full https/);
  });
  it("labels known providers", () => {
    expect(meetingProvider("https://us02web.zoom.us/j/1")).toBe("Zoom");
    expect(meetingProvider("https://meet.google.com/abc-defg-hij")).toBe("Google Meet");
    expect(meetingProvider("https://teams.microsoft.com/l/meetup/x")).toBe("Teams");
    expect(meetingProvider("https://example.com/room")).toBe("Meeting");
    expect(meetingProvider(null)).toBeNull();
  });
  it("threads meetingUrl through add and update actions", () => {
    const added = parseCalendarAction({
      action: "add_milestone",
      orgId: ORG,
      title: "Remote strategy meeting",
      kind: "meeting",
      startsOn: "2026-02-03",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
    });
    expect(added).toMatchObject({ meetingUrl: "https://meet.google.com/abc-defg-hij" });
    const updated = parseCalendarAction({
      action: "update_milestone",
      orgId: ORG,
      id: ID,
      patch: { meetingUrl: null },
    });
    expect(updated).toMatchObject({ patch: { meetingUrl: null } });
    expect(() =>
      parseCalendarAction({
        action: "add_milestone",
        orgId: ORG,
        title: "x",
        kind: "meeting",
        startsOn: "2026-02-03",
        meetingUrl: "ftp://bad",
      }),
    ).toThrow(/https/);
  });
});

describe("SEASON_TEMPLATES", () => {
  it("exposes opt-in packs with unique titles per template", () => {
    expect(SEASON_TEMPLATES.map((template) => template.id)).toEqual([
      "build_season",
      "stop_build_ship",
      "competition_markers",
      "outreach",
      "season_ops",
      "full_season",
    ]);
    for (const template of SEASON_TEMPLATES) {
      const titles = template.entries.map((entry) => entry.title);
      expect(new Set(titles).size).toBe(titles.length);
      const offsets = template.entries.map((entry) => entry.offsetDays);
      expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    }
    expect(SEASON_TEMPLATE).toEqual(getSeasonTemplate("build_season").entries);
    expect(listSeasonTemplates()[0]?.entryCount).toBe(10);
  });

  it("full_season merges packs without duplicate titles", () => {
    const full = getSeasonTemplate("full_season");
    expect(full.entries.length).toBeGreaterThan(10);
    expect(full.entries.some((entry) => entry.title === "Stop-build / bag day")).toBe(true);
    expect(full.entries.some((entry) => entry.title === "Week 1 event")).toBe(true);
    expect(full.entries.some((entry) => entry.kind === "outreach")).toBe(true);
    expect(full.entries.some((entry) => entry.title === "Preseason kickoff meeting")).toBe(true);
  });
});

describe("seedFromKickoff", () => {
  it("dates day 0 on the kickoff date itself for the build template", () => {
    const seeds = seedFromKickoff("2027-01-09");
    expect(seeds.length).toBe(10);
    expect(seeds[0]).toEqual({
      title: "Kickoff & game reveal",
      kind: "kickoff",
      startsOn: "2027-01-09",
      endsOn: null,
      notes: "",
    });
    expect(seeds[1]?.startsOn).toBe("2027-01-10");
  });

  it("carries offsets across month boundaries", () => {
    const seeds = seedFromKickoff("2027-01-09");
    const practice = seeds.find((seed) => seed.title === "Drive practice begins");
    expect(practice?.startsOn).toBe("2027-02-23");
    const freeze = seeds.find((seed) => seed.title === "Software & auto feature freeze");
    expect(freeze?.startsOn).toBe("2027-03-02");
  });

  it("applies spanDays and notes for competition markers", () => {
    const seeds = seedFromKickoff("2027-01-09", "competition_markers");
    const week1 = seeds.find((seed) => seed.title === "Week 1 event");
    expect(week1).toMatchObject({
      kind: "event",
      startsOn: "2027-03-06",
      endsOn: "2027-03-08",
    });
    expect(week1?.notes).toMatch(/real event/i);
  });

  it("supports negative offsets for preseason outreach", () => {
    const seeds = seedFromKickoff("2027-01-09", "outreach");
    const openHouse = seeds.find((seed) => seed.title === "Preseason recruitment open house");
    expect(openHouse?.startsOn).toBe("2026-12-10");
  });
});

describe("milestoneWorkflowLinks", () => {
  it("links deadlines to business and costs", () => {
    const links = milestoneWorkflowLinks({ kind: "deadline" }, ORG);
    expect(links.some((link) => link.href.includes("/business"))).toBe(true);
    expect(links.some((link) => link.href.includes("/costs"))).toBe(true);
  });
});

describe("daysUntil", () => {
  it("returns 0 today, positive for the future, negative for the past", () => {
    expect(daysUntil("2027-01-09", NOW)).toBe(0);
    expect(daysUntil("2027-01-10", NOW)).toBe(1);
    expect(daysUntil("2027-01-16", NOW)).toBe(7);
    expect(daysUntil("2027-01-08", NOW)).toBe(-1);
    expect(daysUntil("2026-12-31", NOW)).toBeLessThan(0);
  });
});

describe("nextUpcoming", () => {
  it("skips done and past milestones and picks the earliest upcoming", () => {
    const next = nextUpcoming(
      [
        milestone({ id: "a", startsOn: "2027-01-02" }),
        milestone({ id: "b", startsOn: "2027-01-09", done: true }),
        milestone({ id: "c", startsOn: "2027-01-23" }),
        milestone({ id: "d", startsOn: "2027-01-16" }),
      ],
      NOW,
    );
    expect(next?.id).toBe("d");
  });

  it("returns null when nothing is upcoming", () => {
    expect(nextUpcoming([], NOW)).toBeNull();
    expect(
      nextUpcoming(
        [milestone({ id: "a", startsOn: "2027-01-02" }), milestone({ id: "b", startsOn: "2027-02-01", done: true })],
        NOW,
      ),
    ).toBeNull();
  });
});

describe("groupByMonth", () => {
  it("orders months ascending with readable labels", () => {
    const groups = groupByMonth([
      milestone({ id: "a", startsOn: "2027-03-02" }),
      milestone({ id: "b", startsOn: "2027-01-09" }),
      milestone({ id: "c", startsOn: "2027-02-23" }),
    ]);
    expect(groups.map((group) => group.month)).toEqual(["2027-01", "2027-02", "2027-03"]);
    expect(groups.map((group) => group.label)).toEqual(["January 2027", "February 2027", "March 2027"]);
  });

  it("sorts items within a month by start date", () => {
    const groups = groupByMonth([
      milestone({ id: "late", startsOn: "2027-01-30" }),
      milestone({ id: "early", startsOn: "2027-01-09" }),
      milestone({ id: "mid", startsOn: "2027-01-16" }),
    ]);
    expect(groups.length).toBe(1);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["early", "mid", "late"]);
  });
});

describe("seasonProgress", () => {
  it("counts done milestones and rounds the percent", () => {
    expect(
      seasonProgress([
        milestone({ id: "a", done: true }),
        milestone({ id: "b", done: true }),
        milestone({ id: "c" }),
        milestone({ id: "d" }),
      ]),
    ).toEqual({ total: 4, done: 2, percent: 50 });
    expect(seasonProgress([])).toEqual({ total: 0, done: 0, percent: 0 });
  });
});

describe("parseCalendarAction", () => {
  it("parses seed_season with default and explicit template ids", () => {
    expect(parseCalendarAction({ action: "seed_season", orgId: ORG, kickoffDate: "2027-1-9" })).toEqual({
      action: "seed_season",
      orgId: ORG,
      kickoffDate: "2027-01-09",
      templateId: "build_season",
    });
    expect(
      parseCalendarAction({
        action: "seed_season",
        orgId: ORG,
        kickoffDate: "2027-01-09",
        templateId: "full_season",
      }),
    ).toMatchObject({ templateId: "full_season" });
    expect(() =>
      parseCalendarAction({
        action: "seed_season",
        orgId: ORG,
        kickoffDate: "2027-01-09",
        templateId: "fake_pack",
      }),
    ).toThrow(/template/i);
  });

  it("rejects invalid calendar dates", () => {
    expect(() => parseCalendarAction({ action: "seed_season", orgId: ORG, kickoffDate: "2027-02-30" })).toThrow(/valid date/);
    expect(() => parseCalendarAction({ action: "seed_season", orgId: ORG, kickoffDate: "next saturday" })).toThrow(/valid date/);
  });

  it("validates every repeat date rather than trusting the client", () => {
    const base = { action: "add_milestone", orgId: ORG, title: "Practice", kind: "practice" as const };

    // Duplicates collapse and the list is sorted, so the series is written in
    // the order it happens.
    const parsed = parseCalendarAction({
      ...base,
      startsOn: "2027-01-12",
      repeatOn: ["2027-01-19", "2027-01-05", "2027-01-19", "2027-01-12"],
    });
    expect(parsed).toMatchObject({ repeatOn: ["2027-01-05", "2027-01-12", "2027-01-19"] });

    // The start date is *not* forced in. "Every Tuesday and Thursday from
    // Monday the 4th" is eight entries; forcing it in made nine, the extra one
    // being a practice on the Monday nobody asked for.
    const monday = parseCalendarAction({
      ...base,
      startsOn: "2027-01-04",
      repeatOn: ["2027-01-05", "2027-01-07"],
    });
    expect((monday as { repeatOn: string[] }).repeatOn).toEqual(["2027-01-05", "2027-01-07"]);

    // A date that is not a date is a rejection, not a silently dropped row:
    // a schedule missing one Thursday for no visible reason is worse than an
    // error saying which value was wrong.
    expect(() =>
      parseCalendarAction({ ...base, startsOn: "2027-01-12", repeatOn: ["2027-13-45"] }),
    ).toThrow(/Repeat date/i);

    // Anything that is not a list of dates falls back to the single entry.
    for (const junk of [null, undefined, "2027-01-19", 7, {}]) {
      expect(
        parseCalendarAction({ ...base, startsOn: "2027-01-12", repeatOn: junk }),
        String(junk),
      ).toMatchObject({ repeatOn: ["2027-01-12"] });
    }
  });

  it("caps a repeat series on the server, not only in the browser", () => {
    // A cap that exists only in the client is not a cap.
    const many = Array.from({ length: 400 }, (_, index) => {
      const day = new Date(Date.UTC(2027, 0, 1) + index * 86_400_000);
      return day.toISOString().slice(0, 10);
    });
    const parsed = parseCalendarAction({
      action: "add_milestone",
      orgId: ORG,
      title: "Practice",
      kind: "practice",
      startsOn: "2027-01-01",
      repeatOn: many,
    });
    expect((parsed as { repeatOn: string[] }).repeatOn.length).toBeLessThanOrEqual(200);
  });

  it("parses add_milestone with defaults and validates the date range", () => {
    expect(
      parseCalendarAction({ action: "add_milestone", orgId: ORG, title: "Scrimmage", kind: "event", startsOn: "2027-02-20" }),
    ).toEqual({
      action: "add_milestone",
      orgId: ORG,
      title: "Scrimmage",
      kind: "event",
      startsOn: "2027-02-20",
      endsOn: null,
      notes: "",
      meetingUrl: null,
      // Always present, always containing the start date. A plain one-off
      // entry is a series of one, so the server has a single insert path and
      // never has to know whether something repeats.
      repeatOn: ["2027-02-20"],
    });
    expect(() =>
      parseCalendarAction({
        action: "add_milestone",
        orgId: ORG,
        title: "Regional",
        kind: "event",
        startsOn: "2027-03-05",
        endsOn: "2027-03-01",
      }),
    ).toThrow(/on or after/);
  });

  it("builds sparse update patches and rejects empty ones", () => {
    const parsed = parseCalendarAction({
      action: "update_milestone",
      orgId: ORG,
      id: ID,
      patch: { title: "Chassis rolling", endsOn: null },
    });
    expect(parsed).toEqual({
      action: "update_milestone",
      orgId: ORG,
      id: ID,
      patch: { title: "Chassis rolling", endsOn: null },
    });
    expect(() => parseCalendarAction({ action: "update_milestone", orgId: ORG, id: ID, patch: {} })).toThrow(/No changes provided/);
    expect(() => parseCalendarAction({ action: "update_milestone", orgId: ORG, id: ID })).toThrow(/No changes provided/);
  });

  it("rejects bad kinds and unsupported actions", () => {
    expect(() =>
      parseCalendarAction({ action: "add_milestone", orgId: ORG, title: "x", kind: "party", startsOn: "2027-02-20" }),
    ).toThrow(/Kind is invalid/);
    expect(() => parseCalendarAction({ action: "update_milestone", orgId: ORG, id: ID, patch: { kind: "sprint" } })).toThrow(
      /Kind is invalid/,
    );
    expect(() => parseCalendarAction({ action: "vanish", orgId: ORG })).toThrow(/Unsupported calendar action/);
  });

  it("parses toggle_done and delete_milestone", () => {
    expect(parseCalendarAction({ action: "toggle_done", orgId: ORG, id: ID, done: true })).toEqual({
      action: "toggle_done",
      orgId: ORG,
      id: ID,
      done: true,
    });
    expect(parseCalendarAction({ action: "delete_milestone", orgId: ORG, id: ID })).toEqual({
      action: "delete_milestone",
      orgId: ORG,
      id: ID,
    });
    expect(() => parseCalendarAction({ action: "delete_milestone", orgId: ORG, id: "not-a-uuid" })).toThrow(/invalid/);
  });
});

describe("offline calendar writes", () => {
  const ready = (): CalendarView => ({
    status: "ready",
    context: { orgId: ORG, orgName: "6925", teamNumber: 6925, role: "member" },
    milestones: [milestone({ id: ID, title: "Drivetrain rolling", done: false })],
    linkedDeadlines: [],
    templates: [],
  });

  it("queues ticks, edits, and deletes, but not a season seed", () => {
    expect(isCalendarQueueableAction("toggle_done")).toBe(true);
    expect(isCalendarQueueableAction("add_milestone")).toBe(true);
    expect(isCalendarQueueableAction("seed_season")).toBe(false);
  });

  it("ticks a date on the last snapshot so the checkbox does not snap back", () => {
    const next = applyCalendarLocalWrite(
      ready(),
      { action: "toggle_done", id: ID, done: true },
      "2027-01-09T12:00:00.000Z",
    );
    expect(next.status).toBe("ready");
    if (next.status !== "ready") return;
    expect(next.milestones[0]?.done).toBe(true);
    expect(next.milestones[0]?.doneAt).toBe("2027-01-09T12:00:00.000Z");
  });

  it("adds a local row, then drops a deleted one", () => {
    const added = applyCalendarLocalWrite(
      ready(),
      { action: "add_milestone", title: "Practice night", kind: "practice", startsOn: "2027-02-01" },
      "2027-01-09T12:00:00.000Z",
      "33333333-3333-4333-8333-333333333333",
    );
    expect(added.status).toBe("ready");
    if (added.status !== "ready") return;
    expect(added.milestones.map((row) => row.title)).toContain("Practice night");
    const deleted = applyCalendarLocalWrite(added, { action: "delete_milestone", id: ID });
    expect(deleted.status).toBe("ready");
    if (deleted.status !== "ready") return;
    expect(deleted.milestones.map((row) => row.id)).toEqual(["33333333-3333-4333-8333-333333333333"]);
  });
});

describe("the list under the grid, about the month the grid is about", () => {
  const row = (id: string, startsOn: string, endsOn: string | null = null): Milestone => ({
    id,
    title: id,
    kind: "event",
    startsOn,
    endsOn,
    notes: "",
    meetingUrl: null,
    done: false,
    doneAt: null,
    doneByName: null,
    createdByName: null,
  });

  it("takes only the month asked for", () => {
    const rows = [row("jan", "2027-01-14"), row("feb", "2027-02-03"), row("mar", "2027-03-09")];
    expect(milestonesInMonth(rows, "2027-02").map((m) => m.id)).toEqual(["feb"]);
  });

  it("keeps a competition that spans into the month", () => {
    // Drawn on the March grid, so a March list without it looks like the list
    // lost it.
    const rows = [row("champs", "2027-02-27", "2027-03-02")];
    expect(milestonesInMonth(rows, "2027-03").map((m) => m.id)).toEqual(["champs"]);
    expect(milestonesInMonth(rows, "2027-02").map((m) => m.id)).toEqual(["champs"]);
  });

  it("keeps a span across a whole month it never starts or ends in", () => {
    expect(milestonesInMonth([row("long", "2027-01-20", "2027-03-05")], "2027-02")).toHaveLength(1);
  });

  it("shows a row with a backwards end date rather than hiding it", () => {
    // Bad data is a reason to show the row so somebody can fix it.
    expect(milestonesInMonth([row("typo", "2027-02-10", "2027-01-01")], "2027-02")).toHaveLength(1);
  });

  it("sorts by date then title", () => {
    const rows = [row("b", "2027-02-10"), row("a", "2027-02-10"), row("early", "2027-02-01")];
    expect(milestonesInMonth(rows, "2027-02").map((m) => m.id)).toEqual(["early", "a", "b"]);
  });

  it("returns nothing for a month that is not a month", () => {
    expect(milestonesInMonth([row("a", "2027-02-10")], "February")).toEqual([]);
    expect(milestonesInMonth([row("a", "2027-02-10")], "")).toEqual([]);
  });
});

describe("deleting a whole repeat series", () => {
  it("parses the action", () => {
    expect(
      parseCalendarAction({
        action: "delete_series",
        orgId: "11111111-1111-4111-8111-111111111111",
        seriesId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toEqual({
      action: "delete_series",
      orgId: "11111111-1111-4111-8111-111111111111",
      seriesId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("refuses a series id that is not an id", () => {
    // It deletes every row that matches, so a loose value here is the
    // difference between removing a practice schedule and removing nothing at
    // all — or worse, something else.
    for (const bad of ["", "all", "22222222-2222", null, 7]) {
      expect(() =>
        parseCalendarAction({
          action: "delete_series",
          orgId: "11111111-1111-4111-8111-111111111111",
          seriesId: bad,
        }),
        String(bad),
      ).toThrow();
    }
  });

  it("stays online-only, like seeding a season", () => {
    // Both write many rows at once. A queued delete of forty entries replayed
    // against a calendar somebody else has edited is not something the local
    // snapshot can honestly represent.
    expect(isCalendarQueueableAction("delete_series")).toBe(false);
    expect(isCalendarQueueableAction("delete_milestone")).toBe(true);
  });
});
