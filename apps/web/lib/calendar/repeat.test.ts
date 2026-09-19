import { describe, expect, it } from "vitest";
import {
  MAX_OCCURRENCES,
  describeRepeat,
  expandRepeat,
  type RepeatRule,
  type Weekday,
} from "./repeat";

const rule = (weekdays: Weekday[], until: string, everyWeeks?: number): RepeatRule => ({
  weekdays,
  until,
  ...(everyWeeks == null ? {} : { everyWeeks }),
});

const TUE = 2 as Weekday;
const THU = 4 as Weekday;
const SAT = 6 as Weekday;

describe("a practice schedule", () => {
  it("lands on the days it was told to, and no others", () => {
    // 2027-01-04 is a Monday.
    const { dates } = expandRepeat("2027-01-04", rule([TUE, THU], "2027-01-22"));
    expect(dates).toEqual([
      "2027-01-05",
      "2027-01-07",
      "2027-01-12",
      "2027-01-14",
      "2027-01-19",
      "2027-01-21",
    ]);
    for (const date of dates) {
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      expect([2, 4]).toContain(day);
    }
  });

  it("does not include the day the form happened to be filled in on", () => {
    // Picking "every Tuesday" on a Monday means the Tuesday. Including the
    // Monday would put a practice on a day nobody chose.
    const { dates } = expandRepeat("2027-01-04", rule([TUE], "2027-01-20"));
    expect(dates).not.toContain("2027-01-04");
    expect(dates[0]).toBe("2027-01-05");
  });

  it("includes the start date when it is one of the chosen days", () => {
    const { dates } = expandRepeat("2027-01-05", rule([TUE], "2027-01-20"));
    expect(dates[0]).toBe("2027-01-05");
  });

  it("stops on the last day, inclusive", () => {
    const { dates } = expandRepeat("2027-01-05", rule([TUE], "2027-01-19"));
    expect(dates[dates.length - 1]).toBe("2027-01-19");
  });

  it("does every other week when asked", () => {
    const { dates } = expandRepeat("2027-01-05", rule([TUE], "2027-02-16", 2));
    expect(dates).toEqual(["2027-01-05", "2027-01-19", "2027-02-02", "2027-02-16"]);
  });

  it("counts fortnights from the week it starts, not from an arbitrary epoch", () => {
    // Shifting the start by one week must shift the whole series by one week,
    // not reshuffle which weeks are "on".
    const first = expandRepeat("2027-01-05", rule([TUE], "2027-02-16", 2)).dates;
    const second = expandRepeat("2027-01-12", rule([TUE], "2027-02-16", 2)).dates;
    expect(first).toContain("2027-01-05");
    expect(second).toContain("2027-01-12");
    expect(second).not.toContain("2027-01-05");
  });
});

describe("the ways somebody half-fills the form", () => {
  it("makes one entry when no days are chosen", () => {
    // This is how "do not repeat" is expressed, and it is the default.
    expect(expandRepeat("2027-01-05", rule([], "2027-03-01")).dates).toEqual(["2027-01-05"]);
  });

  it("makes one entry when the end date is before the start", () => {
    // Not an empty series — somebody who has not finished typing. Producing
    // nothing would make pressing Add look broken.
    expect(expandRepeat("2027-01-20", rule([TUE], "2027-01-05")).dates).toEqual(["2027-01-20"]);
  });

  it("makes one entry when the end date is missing or nonsense", () => {
    expect(expandRepeat("2027-01-05", rule([TUE], "")).dates).toEqual(["2027-01-05"]);
    expect(expandRepeat("2027-01-05", rule([TUE], "next march")).dates).toEqual(["2027-01-05"]);
  });

  it("still produces the chosen day when the rule matches nothing in range", () => {
    // Every Saturday, between a Monday and the Wednesday after it.
    const { dates } = expandRepeat("2027-01-04", rule([SAT], "2027-01-06"));
    expect(dates).toEqual(["2027-01-04"]);
  });

  it("returns nothing at all only when the start date is not a date", () => {
    expect(expandRepeat("2027-02-30", rule([TUE], "2027-03-01")).dates).toEqual([]);
    expect(expandRepeat("", rule([TUE], "2027-03-01")).dates).toEqual([]);
  });

  it("treats a nonsense cadence as every week", () => {
    const weekly = expandRepeat("2027-01-05", rule([TUE], "2027-01-26")).dates;
    for (const bad of [0, -3, Number.NaN, 0.5]) {
      expect(expandRepeat("2027-01-05", rule([TUE], "2027-01-26", bad)).dates, String(bad)).toEqual(
        weekly,
      );
    }
  });
});

describe("a typo in the year cannot make thirty thousand practices", () => {
  it("caps the series and says it did", () => {
    const { dates, truncated } = expandRepeat("2027-01-05", rule([1, 2, 3, 4, 5] as Weekday[], "2127-01-05"));
    expect(dates).toHaveLength(MAX_OCCURRENCES);
    expect(truncated).toBe(true);
    expect(dates[0]).toBe("2027-01-05");
  });

  it("does not claim truncation for a season-length schedule", () => {
    // Three evenings a week from kickoff to championship is the real case and
    // must fit comfortably under the cap.
    const { dates, truncated } = expandRepeat("2027-01-09", rule([TUE, THU, SAT], "2027-04-20"));
    expect(truncated).toBe(false);
    expect(dates.length).toBeGreaterThan(30);
    expect(dates.length).toBeLessThan(MAX_OCCURRENCES);
  });
});

describe("crossing the things that break date maths", () => {
  it("does not skip or double a week across spring-forward", () => {
    // US DST 2027 begins Sunday 14 March. Stepping in local hours loses a day.
    const { dates } = expandRepeat("2027-03-09", rule([TUE], "2027-03-30"));
    expect(dates).toEqual(["2027-03-09", "2027-03-16", "2027-03-23", "2027-03-30"]);
  });

  it("crosses a month boundary and a leap day", () => {
    const { dates } = expandRepeat("2028-02-22", rule([TUE], "2028-03-07"));
    expect(dates).toEqual(["2028-02-22", "2028-02-29", "2028-03-07"]);
  });

  it("crosses a year boundary", () => {
    const { dates } = expandRepeat("2026-12-29", rule([TUE], "2027-01-12"));
    expect(dates).toEqual(["2026-12-29", "2027-01-05", "2027-01-12"]);
  });
});

describe("saying what is about to happen", () => {
  it("names the days in week order, however they were clicked", () => {
    expect(describeRepeat(rule([THU, TUE], "2027-03-01"), 12)).toBe("12 entries — Tue and Thu");
  });

  it("says Once when it is not repeating", () => {
    expect(describeRepeat(rule([], "2027-03-01"), 1)).toBe("Once");
    expect(describeRepeat(rule([TUE], "2027-03-01"), 1)).toBe("Once");
  });

  it("mentions the cadence only when it is not weekly", () => {
    expect(describeRepeat(rule([TUE], "2027-03-01", 2), 6)).toContain("every 2 weeks");
    expect(describeRepeat(rule([TUE], "2027-03-01"), 6)).not.toContain("every");
  });

  it("reads as a list for three or more days", () => {
    expect(describeRepeat(rule([TUE, THU, SAT], "2027-03-01"), 30)).toBe(
      "30 entries — Tue, Thu and Sat",
    );
  });
});
