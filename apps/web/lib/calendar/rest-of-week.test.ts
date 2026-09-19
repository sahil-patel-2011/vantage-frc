import { describe, expect, it } from "vitest";
import { restOfWeek, weekdayLabel } from "./rest-of-week";
import type { OverlayMeeting } from "./meetings-overlay";
import type { Milestone, MilestoneKind } from "../season-calendar";

const milestone = (
  over: Partial<Milestone> & { id: string; startsOn: string },
): Milestone => ({
  title: over.id,
  kind: "event" as MilestoneKind,
  endsOn: null,
  notes: "",
  meetingUrl: null,
  done: false,
  doneAt: null,
  doneByName: null,
  createdByName: null,
  ...over,
});

/** Local wall clock, because which square a meeting lands in is local. */
function at(day: string, hour: number, minute = 0): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, hour, minute, 0, 0).toISOString();
}

const meeting = (day: string, hour: number, endHour: number | null, title: string): OverlayMeeting => ({
  id: `${day}-${hour}`,
  title,
  startsAt: at(day, hour),
  endsAt: endHour === null ? null : at(day, endHour),
  subteamName: null,
  subteamColor: null,
});

// 2027-02-10 is a Wednesday; its week (Sunday start) is the 7th to the 13th.
const WEDNESDAY = "2027-02-10";

describe("what is left this week", () => {
  it("runs from today to the end of the week the grid is drawing", () => {
    const { days } = restOfWeek([], [], { today: WEDNESDAY });
    expect(days).toEqual(["2027-02-10", "2027-02-11", "2027-02-12", "2027-02-13"]);
  });

  it("does not look back at days already spent", () => {
    const { entries } = restOfWeek(
      [milestone({ id: "monday", startsOn: "2027-02-08" })],
      [meeting("2027-02-09", 18, 21, "Tuesday build")],
      { today: WEDNESDAY },
    );
    expect(entries).toEqual([]);
  });

  it("does not look past the end of the week either", () => {
    // "This week" and the week the grid draws have to mean the same week.
    const { entries } = restOfWeek(
      [milestone({ id: "sunday", startsOn: "2027-02-14" })],
      [],
      { today: WEDNESDAY },
    );
    expect(entries).toEqual([]);
  });

  it("takes milestones and meetings together", () => {
    const { entries } = restOfWeek(
      [milestone({ id: "scrim", title: "Scrimmage", startsOn: "2027-02-13" })],
      [meeting("2027-02-11", 18, 21, "Build night")],
      { today: WEDNESDAY },
    );
    expect(entries.map((entry) => entry.title)).toEqual(["Build night", "Scrimmage"]);
  });

  it("puts a whole-day entry above the evening it contains", () => {
    // The milestone is the shape of the day; the meeting is what happens in it.
    const { entries } = restOfWeek(
      [milestone({ id: "comp", title: "Competition", startsOn: "2027-02-11" })],
      [meeting("2027-02-11", 18, 21, "Build night")],
      { today: WEDNESDAY },
    );
    expect(entries.map((entry) => entry.kind)).toEqual(["milestone", "meeting"]);
  });

  it("orders a day's meetings by time", () => {
    const { entries } = restOfWeek(
      [],
      [meeting("2027-02-11", 19, 21, "Late"), meeting("2027-02-11", 8, 9, "Early")],
      { today: WEDNESDAY },
    );
    expect(entries.map((entry) => entry.title)).toEqual(["Early", "Late"]);
  });

  it("carries a meeting's time and leaves a milestone's blank", () => {
    const { entries } = restOfWeek(
      [milestone({ id: "m", title: "Bag day", startsOn: "2027-02-12" })],
      [meeting("2027-02-11", 18, 21, "Build night")],
      { today: WEDNESDAY },
    );
    expect(entries[0]).toMatchObject({ title: "Build night", timeLabel: "6–9 PM" });
    expect(entries[1]).toMatchObject({ title: "Bag day", timeLabel: "" });
  });

  it("skips a milestone already ticked off", () => {
    const { entries } = restOfWeek(
      [milestone({ id: "done", startsOn: "2027-02-11", done: true })],
      [],
      { today: WEDNESDAY },
    );
    expect(entries).toEqual([]);
  });
});

describe("a competition that is already under way", () => {
  it("shows on the first day of the week that is left, not only on its first day", () => {
    // Monday to Friday, asked on Wednesday: it is still on.
    const { entries } = restOfWeek(
      [milestone({ id: "champs", title: "Champs", startsOn: "2027-02-08", endsOn: "2027-02-12" })],
      [],
      { today: WEDNESDAY },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ title: "Champs", date: WEDNESDAY });
  });

  it("reports it once, not once per day it covers", () => {
    const { entries } = restOfWeek(
      [milestone({ id: "champs", startsOn: "2027-02-08", endsOn: "2027-02-13" })],
      [],
      { today: WEDNESDAY },
    );
    expect(entries).toHaveLength(1);
  });

  it("ignores one that ended before today", () => {
    expect(
      restOfWeek(
        [milestone({ id: "past", startsOn: "2027-02-07", endsOn: "2027-02-09" })],
        [],
        { today: WEDNESDAY },
      ).entries,
    ).toEqual([]);
  });

  it("treats an end before the start as no end at all", () => {
    const { entries } = restOfWeek(
      [milestone({ id: "typo", startsOn: "2027-02-11", endsOn: "2027-02-01" })],
      [],
      { today: WEDNESDAY },
    );
    expect(entries).toHaveLength(1);
  });
});

describe("the awkward weeks", () => {
  it("is just today when today is the last day of the week", () => {
    const { days } = restOfWeek([], [], { today: "2027-02-13" });
    expect(days).toEqual(["2027-02-13"]);
  });

  it("crosses a month boundary without dropping either side", () => {
    // 2027-02-28 is a Sunday, so this week runs into March.
    const { entries } = restOfWeek(
      [
        milestone({ id: "feb", title: "Feb thing", startsOn: "2027-02-28" }),
        milestone({ id: "mar", title: "Mar thing", startsOn: "2027-03-02" }),
      ],
      [],
      { today: "2027-02-28" },
    );
    expect(entries.map((entry) => entry.title)).toEqual(["Feb thing", "Mar thing"]);
  });

  it("honours a Monday-start week", () => {
    const { days } = restOfWeek([], [], { today: WEDNESDAY, weekStartsOn: 1 });
    expect(days[days.length - 1]).toBe("2027-02-14");
  });

  it("returns nothing at all when today is not a date", () => {
    expect(restOfWeek([], [], { today: "soon" })).toEqual({ days: [], entries: [] });
  });
});

describe("the column an entry sits under", () => {
  it("names the weekday", () => {
    expect(weekdayLabel("2027-02-10")).toMatch(/Wed/);
  });

  it("is empty rather than 'Invalid Date' for nonsense", () => {
    expect(weekdayLabel("whenever")).toBe("");
  });
});
