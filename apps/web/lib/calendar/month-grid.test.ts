import { describe, expect, it } from "vitest";
import {
  buildMonthGrid,
  localToday,
  milestoneDays,
  monthLabel,
  monthOf,
  parseDay,
  shiftMonth,
  weekOf,
} from "./month-grid";
import type { Milestone } from "../season-calendar";

function milestone(partial: Partial<Milestone> & { startsOn: string }): Milestone {
  return {
    id: partial.id ?? partial.startsOn,
    title: partial.title ?? "Thing",
    kind: partial.kind ?? "build",
    startsOn: partial.startsOn,
    endsOn: partial.endsOn ?? null,
    notes: "",
    meetingUrl: null,
    done: partial.done ?? false,
    doneAt: null,
    doneByName: null,
    createdByName: null,
  };
}

const days = (grid: ReturnType<typeof buildMonthGrid>) => grid.weeks.flat();
const dayOn = (grid: ReturnType<typeof buildMonthGrid>, date: string) => {
  const found = days(grid).find((day) => day.date === date);
  if (!found) throw new Error(`no cell for ${date}`);
  return found;
};

describe("parseDay", () => {
  it("reads a plain date", () => {
    expect(parseDay("2027-02-01")).toBe(Date.UTC(2027, 1, 1));
  });

  it("refuses days that do not exist rather than rolling them forward", () => {
    // Date.UTC(2027, 1, 30) is silently March 2nd. A calendar that accepts
    // that puts an event on a day the user never picked.
    expect(parseDay("2027-02-30")).toBeNull();
    expect(parseDay("2027-04-31")).toBeNull();
    expect(parseDay("2027-13-01")).toBeNull();
    expect(parseDay("2027-00-10")).toBeNull();
  });

  it("accepts the leap day only in a leap year", () => {
    expect(parseDay("2028-02-29")).not.toBeNull();
    expect(parseDay("2027-02-29")).toBeNull();
  });

  it("refuses anything that is not YYYY-MM-DD", () => {
    for (const bad of ["", "2027-2-1", "20270201", "next friday", "2027-02-01T00:00:00"]) {
      expect(parseDay(bad), bad).toBeNull();
    }
  });
});

describe("the shape of a month", () => {
  it("is whole weeks, so the columns line up under their headings", () => {
    for (const month of ["2027-01", "2027-02", "2027-04", "2028-02", "2026-11"]) {
      const grid = buildMonthGrid(month, []);
      expect(grid.weeks.every((week) => week.length === 7), month).toBe(true);
    }
  });

  it("starts on the weekday the headings say it does", () => {
    const sunday = buildMonthGrid("2027-02", [], { weekStartsOn: 0 });
    expect(sunday.weekdayLabels[0]).toBe("Sun");
    expect(new Date(`${sunday.weeks[0]![0]!.date}T00:00:00Z`).getUTCDay()).toBe(0);

    const monday = buildMonthGrid("2027-02", [], { weekStartsOn: 1 });
    expect(monday.weekdayLabels[0]).toBe("Mon");
    expect(new Date(`${monday.weeks[0]![0]!.date}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it("contains every day of the month exactly once", () => {
    const grid = buildMonthGrid("2027-02", []);
    const own = days(grid).filter((day) => day.inMonth);
    expect(own).toHaveLength(28);
    expect(new Set(own.map((day) => day.date)).size).toBe(28);
    expect(own[0]!.date).toBe("2027-02-01");
    expect(own[own.length - 1]!.date).toBe("2027-02-28");
  });

  it("pads with the neighbouring months rather than leaving holes", () => {
    // February 2027 starts on a Monday, so one Sunday of January leads it.
    const grid = buildMonthGrid("2027-02", [], { weekStartsOn: 0 });
    expect(grid.weeks[0]![0]!.date).toBe("2027-01-31");
    expect(grid.weeks[0]![0]!.inMonth).toBe(false);
    const last = grid.weeks[grid.weeks.length - 1]!;
    expect(last[6]!.inMonth).toBe(false);
    expect(monthOf(last[6]!.date)).toBe("2027-03");
  });

  it("handles a month that needs six rows", () => {
    // 31 days beginning on a Saturday is the worst case.
    const grid = buildMonthGrid("2027-05", [], { weekStartsOn: 0 });
    expect(grid.weeks.length).toBe(6);
    expect(days(grid).filter((day) => day.inMonth)).toHaveLength(31);
  });

  it("gets February right in a leap year", () => {
    const grid = buildMonthGrid("2028-02", []);
    expect(days(grid).filter((day) => day.inMonth)).toHaveLength(29);
    expect(dayOn(grid, "2028-02-29").inMonth).toBe(true);
  });

  it("falls back to this month instead of throwing on nonsense", () => {
    const grid = buildMonthGrid("not-a-month", []);
    expect(grid.month).toBe(localToday().slice(0, 7));
    expect(grid.weeks.length).toBeGreaterThan(0);
  });
});

describe("placing milestones on days", () => {
  it("puts a one-day milestone on its own day and nowhere else", () => {
    const grid = buildMonthGrid("2027-02", [milestone({ startsOn: "2027-02-10", title: "Scrimmage" })]);
    expect(dayOn(grid, "2027-02-10").entries).toHaveLength(1);
    expect(dayOn(grid, "2027-02-10").entries[0]!.span).toBe("single");
    expect(days(grid).filter((day) => day.entries.length)).toHaveLength(1);
  });

  it("runs a multi-day milestone across every day it covers", () => {
    const grid = buildMonthGrid("2027-02", [
      milestone({ startsOn: "2027-02-12", endsOn: "2027-02-14", title: "District event" }),
    ]);
    expect(dayOn(grid, "2027-02-12").entries[0]!.span).toBe("start");
    expect(dayOn(grid, "2027-02-13").entries[0]!.span).toBe("middle");
    expect(dayOn(grid, "2027-02-14").entries[0]!.span).toBe("end");
    expect(dayOn(grid, "2027-02-15").entries).toHaveLength(0);
  });

  it("shows a milestone that runs in from the previous month", () => {
    // The event started in January; the February grid must still show it.
    const grid = buildMonthGrid("2027-02", [
      milestone({ startsOn: "2027-01-30", endsOn: "2027-02-02", title: "Kickoff weekend" }),
    ]);
    expect(dayOn(grid, "2027-02-01").entries).toHaveLength(1);
    expect(dayOn(grid, "2027-02-02").entries[0]!.span).toBe("end");
  });

  it("treats an end before the start as a one-day entry, not an empty one", () => {
    const grid = buildMonthGrid("2027-02", [
      milestone({ startsOn: "2027-02-10", endsOn: "2027-02-01", title: "Typo" }),
    ]);
    expect(dayOn(grid, "2027-02-10").entries).toHaveLength(1);
    expect(dayOn(grid, "2027-02-01").entries).toHaveLength(0);
  });

  it("drops a milestone whose start is not a real date instead of rendering garbage", () => {
    const grid = buildMonthGrid("2027-02", [milestone({ startsOn: "2027-02-31", title: "Nope" })]);
    expect(days(grid).some((day) => day.entries.length)).toBe(false);
  });

  it("orders a day's entries the same way every render", () => {
    const grid = buildMonthGrid("2027-02", [
      milestone({ id: "c", startsOn: "2027-02-10", title: "Zebra" }),
      milestone({ id: "a", startsOn: "2027-02-08", endsOn: "2027-02-11", title: "Long run" }),
      milestone({ id: "b", startsOn: "2027-02-10", title: "Alpha" }),
    ]);
    expect(dayOn(grid, "2027-02-10").entries.map((entry) => entry.milestone.title)).toEqual([
      "Long run",
      "Alpha",
      "Zebra",
    ]);
  });

  it("marks today, and only today", () => {
    const grid = buildMonthGrid("2027-02", [], { today: "2027-02-14" });
    expect(days(grid).filter((day) => day.isToday).map((day) => day.date)).toEqual(["2027-02-14"]);
  });

  it("marks no day when today is in another month", () => {
    const grid = buildMonthGrid("2027-02", [], { today: "2027-06-01" });
    expect(days(grid).some((day) => day.isToday)).toBe(false);
  });

  it("marks weekends, which is when an FRC team is mostly in the shop", () => {
    const grid = buildMonthGrid("2027-02", []);
    expect(dayOn(grid, "2027-02-06").isWeekend).toBe(true); // Saturday
    expect(dayOn(grid, "2027-02-07").isWeekend).toBe(true); // Sunday
    expect(dayOn(grid, "2027-02-08").isWeekend).toBe(false);
  });
});

describe("milestoneDays", () => {
  it("is inclusive of both ends", () => {
    expect(milestoneDays(milestone({ startsOn: "2027-03-01", endsOn: "2027-03-03" }))).toEqual([
      "2027-03-01",
      "2027-03-02",
      "2027-03-03",
    ]);
  });

  it("crosses a month boundary without losing a day", () => {
    expect(milestoneDays(milestone({ startsOn: "2027-02-27", endsOn: "2027-03-02" }))).toEqual([
      "2027-02-27",
      "2027-02-28",
      "2027-03-01",
      "2027-03-02",
    ]);
  });

  it("crosses a leap day", () => {
    expect(milestoneDays(milestone({ startsOn: "2028-02-28", endsOn: "2028-03-01" }))).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });

  it("refuses to build thirty thousand days out of one mistyped year", () => {
    const runaway = milestoneDays(milestone({ startsOn: "2027-01-01", endsOn: "2127-01-01" }));
    expect(runaway.length).toBeLessThanOrEqual(400);
    expect(runaway[0]).toBe("2027-01-01");
  });
});

describe("moving around", () => {
  it("steps months and wraps the year in both directions", () => {
    expect(shiftMonth("2027-02", 1)).toBe("2027-03");
    expect(shiftMonth("2027-12", 1)).toBe("2028-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
    expect(shiftMonth("2027-02", 12)).toBe("2028-02");
    expect(shiftMonth("2027-02", 0)).toBe("2027-02");
  });

  it("leaves a month it cannot read alone", () => {
    expect(shiftMonth("nonsense", 1)).toBe("nonsense");
  });

  it("labels a month the way a person would read it aloud", () => {
    expect(monthLabel("2027-02")).toBe("February 2027");
    expect(monthLabel("2027-12")).toBe("December 2027");
  });

  it("gives the seven days around a date", () => {
    // 2027-02-10 is a Wednesday.
    expect(weekOf("2027-02-10", 0)).toEqual([
      "2027-02-07",
      "2027-02-08",
      "2027-02-09",
      "2027-02-10",
      "2027-02-11",
      "2027-02-12",
      "2027-02-13",
    ]);
    expect(weekOf("2027-02-10", 1)[0]).toBe("2027-02-08");
    expect(weekOf("garbage")).toEqual([]);
  });
});

describe("timezone safety", () => {
  /**
   * The bug this file exists to avoid: a date-only string parsed as UTC and
   * then read back through local getters lands on the previous day for anybody
   * west of Greenwich. Every cell's `date` must be the string it was built
   * from, whatever the machine's zone.
   */
  it("keeps the first of the month on the first, whatever the zone", () => {
    const grid = buildMonthGrid("2027-02", [milestone({ startsOn: "2027-02-01", title: "First" })]);
    expect(dayOn(grid, "2027-02-01").entries).toHaveLength(1);
    expect(dayOn(grid, "2027-01-31").entries).toHaveLength(0);
  });

  it("does not skip or repeat a day across a spring-forward weekend", () => {
    // US DST 2027 begins Sunday 14 March. Stepping in local hours would make
    // this 13 days or 15, not 14.
    const march = buildMonthGrid("2027-03", []);
    const own = days(march).filter((day) => day.inMonth).map((day) => day.date);
    expect(own).toHaveLength(31);
    expect(new Set(own).size).toBe(31);
    expect(milestoneDays(milestone({ startsOn: "2027-03-12", endsOn: "2027-03-16" }))).toEqual([
      "2027-03-12",
      "2027-03-13",
      "2027-03-14",
      "2027-03-15",
      "2027-03-16",
    ]);
  });
});

describe("the source keeps its own rule", () => {
  /**
   * The tests above pass in every zone because the module never builds a local
   * `Date` from a date-only string. That is an invariant of the file, not of
   * its output, and the next person to add a helper here will not have these
   * zones in mind — so check the rule rather than only its consequences.
   */
  it("never parses a date-only string into local time", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const raw = readFileSync(join(__dirname, "month-grid.ts"), "utf8");
    // Comments explain the trap by quoting it, so they are not code and must
    // not be searched — the first run of this guard failed on the file's own
    // documentation, which is a guard finding the warning rather than the bug.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

    // `new Date("2027-02-01T00:00:00")` — no trailing Z — is midnight local.
    expect(source).not.toMatch(/T00:00:00(?!Z)["'`]/);
    // `getFullYear`/`getMonth`/`getDate` read a Date in local time. The only
    // place that is correct is localToday(), which is about the wall clock.
    const localReads = [...source.matchAll(/\.get(?!UTC)(FullYear|Month|Date|Day)\(/g)];
    const insideLocalToday = source
      .slice(source.indexOf("export function localToday"), source.indexOf("export function milestoneDays"))
      .match(/\.get(?!UTC)(FullYear|Month|Date|Day)\(/g);
    expect(insideLocalToday).not.toBeNull();
    expect(localReads.map((match) => match[0])).toHaveLength(insideLocalToday!.length);
  });
});
