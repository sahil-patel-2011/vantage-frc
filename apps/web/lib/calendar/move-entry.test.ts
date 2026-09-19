import { describe, expect, it } from "vitest";
import { describeMove, moveByDays, moveToDate } from "./move-entry";
import type { Milestone } from "../season-calendar";

const entry = (startsOn: string, endsOn: string | null = null): Milestone => ({
  id: "m1",
  title: "Week 1 Regional",
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

describe("dropping an entry on a day", () => {
  it("moves a one-day entry there", () => {
    expect(moveToDate(entry("2027-03-05"), "2027-03-12")).toEqual({
      startsOn: "2027-03-12",
      endsOn: null,
    });
  });

  it("moves a competition backwards as easily as forwards", () => {
    expect(moveToDate(entry("2027-03-12"), "2027-03-05")).toEqual({
      startsOn: "2027-03-05",
      endsOn: null,
    });
  });

  it("keeps the length of a multi-day competition", () => {
    // Friday to Sunday dropped on a Friday is Friday to Sunday. The end has to
    // travel with the start or the entry ends before it begins.
    expect(moveToDate(entry("2027-03-05", "2027-03-07"), "2027-03-12")).toEqual({
      startsOn: "2027-03-12",
      endsOn: "2027-03-14",
    });
  });

  it("does nothing when it is dropped where it already is", () => {
    // Not an error, and not a write: a no-op round trip to the database is a
    // spinner and an audit row for nothing.
    expect(moveToDate(entry("2027-03-05"), "2027-03-05")).toBeNull();
  });

  it("does nothing when the target is not a date", () => {
    expect(moveToDate(entry("2027-03-05"), "next friday")).toBeNull();
    expect(moveToDate(entry("2027-03-05"), "")).toBeNull();
    expect(moveToDate(entry("2027-03-05"), "2027-02-30")).toBeNull();
  });

  it("does nothing when the entry's own date is not a date", () => {
    expect(moveToDate(entry("sometime"), "2027-03-12")).toBeNull();
  });
});

describe("nudging by days", () => {
  it("moves later and earlier", () => {
    expect(moveByDays(entry("2027-03-05"), 1)?.startsOn).toBe("2027-03-06");
    expect(moveByDays(entry("2027-03-05"), -1)?.startsOn).toBe("2027-03-04");
  });

  it("moves a week, which is how a schedule actually slips", () => {
    expect(moveByDays(entry("2027-03-05"), 7)?.startsOn).toBe("2027-03-12");
    expect(moveByDays(entry("2027-03-05"), -7)?.startsOn).toBe("2027-02-26");
  });

  it("carries the span", () => {
    expect(moveByDays(entry("2027-03-05", "2027-03-07"), 7)).toEqual({
      startsOn: "2027-03-12",
      endsOn: "2027-03-14",
    });
  });

  it("does nothing for a move of nothing", () => {
    expect(moveByDays(entry("2027-03-05"), 0)).toBeNull();
    expect(moveByDays(entry("2027-03-05"), Number.NaN)).toBeNull();
  });
});

describe("the date maths that breaks date maths", () => {
  it("steps over spring-forward without losing the day", () => {
    // US DST 2027 begins Sunday 14 March. Stepping in local hours lands on the
    // 13th.
    expect(moveByDays(entry("2027-03-07"), 7)?.startsOn).toBe("2027-03-14");
    expect(moveByDays(entry("2027-03-14"), -7)?.startsOn).toBe("2027-03-07");
  });

  it("crosses a leap day", () => {
    expect(moveByDays(entry("2028-02-28"), 1)?.startsOn).toBe("2028-02-29");
    expect(moveByDays(entry("2028-02-29"), 1)?.startsOn).toBe("2028-03-01");
  });

  it("crosses a year boundary in both directions", () => {
    expect(moveByDays(entry("2026-12-30"), 7)?.startsOn).toBe("2027-01-06");
    expect(moveByDays(entry("2027-01-03"), -7)?.startsOn).toBe("2026-12-27");
  });
});

describe("an entry whose dates are already wrong", () => {
  it("lands as a single day rather than encoding a negative duration", () => {
    // The end is before the start, which is bad data. Moving it must not carry
    // that forward as a duration.
    expect(moveToDate(entry("2027-03-10", "2027-03-01"), "2027-03-17")).toEqual({
      startsOn: "2027-03-17",
      endsOn: null,
    });
  });

  it("drops an end date that will not parse instead of guessing one", () => {
    expect(moveToDate(entry("2027-03-10", "the sunday"), "2027-03-17")).toEqual({
      startsOn: "2027-03-17",
      endsOn: null,
    });
  });

  it("treats an empty end date as no end date", () => {
    expect(moveToDate(entry("2027-03-10", ""), "2027-03-17")).toEqual({
      startsOn: "2027-03-17",
      endsOn: null,
    });
  });
});

describe("saying what happened", () => {
  it("names the day it landed on", () => {
    expect(describeMove({ startsOn: "2027-03-12" })).toMatch(/Moved to .*12/);
  });

  it("says something rather than nothing for a patch without a date", () => {
    expect(describeMove({})).toBe("Moved");
  });
});
