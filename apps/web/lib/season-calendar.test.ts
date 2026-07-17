import { describe, expect, it } from "vitest";
import {
  daysUntil,
  groupByMonth,
  nextUpcoming,
  parseCalendarAction,
  SEASON_TEMPLATE,
  seasonProgress,
  seedFromKickoff,
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
    done: false,
    doneAt: null,
    doneByName: null,
    createdByName: null,
    ...overrides,
  };
}

describe("SEASON_TEMPLATE", () => {
  it("spans kickoff through feature freeze with unique ascending offsets", () => {
    expect(SEASON_TEMPLATE.length).toBe(10);
    expect(SEASON_TEMPLATE[0]).toMatchObject({ offsetDays: 0, kind: "kickoff" });
    const offsets = SEASON_TEMPLATE.map((entry) => entry.offsetDays);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    const titles = SEASON_TEMPLATE.map((entry) => entry.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("seedFromKickoff", () => {
  it("dates day 0 on the kickoff date itself", () => {
    const seeds = seedFromKickoff("2027-01-09");
    expect(seeds.length).toBe(10);
    expect(seeds[0]).toEqual({ title: "Kickoff & game reveal", kind: "kickoff", startsOn: "2027-01-09" });
    expect(seeds[1]?.startsOn).toBe("2027-01-10");
  });

  it("carries offsets across month boundaries", () => {
    const seeds = seedFromKickoff("2027-01-09");
    const practice = seeds.find((seed) => seed.title === "Drive practice begins");
    expect(practice?.startsOn).toBe("2027-02-23"); // day 45 crosses into February
    const freeze = seeds.find((seed) => seed.title === "Software & auto feature freeze");
    expect(freeze?.startsOn).toBe("2027-03-02"); // day 52 crosses non-leap February
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
        milestone({ id: "a", startsOn: "2027-01-02" }), // past
        milestone({ id: "b", startsOn: "2027-01-09", done: true }), // today but done
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
  it("parses seed_season and normalizes the kickoff date", () => {
    expect(parseCalendarAction({ action: "seed_season", orgId: ORG, kickoffDate: "2027-1-9" })).toEqual({
      action: "seed_season",
      orgId: ORG,
      kickoffDate: "2027-01-09",
    });
  });

  it("rejects invalid calendar dates", () => {
    expect(() => parseCalendarAction({ action: "seed_season", orgId: ORG, kickoffDate: "2027-02-30" })).toThrow(/valid date/);
    expect(() => parseCalendarAction({ action: "seed_season", orgId: ORG, kickoffDate: "next saturday" })).toThrow(/valid date/);
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
