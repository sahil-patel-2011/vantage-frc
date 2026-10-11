import { describe, expect, it } from "vitest";
import {
  addedNote,
  dayNum,
  fmtRange,
  fmtTime,
  fmtWhen,
  isSeriesEvent,
  withOrg,
  type RecurringEvent,
} from "./calendar-model";

describe("the note after adding an event (A5-06)", () => {
  const now = new Date(2026, 9, 11, 12, 0).getTime();
  it("never claims a past event is under Coming up", () => {
    const past = addedNote("Kickoff", new Date(2026, 9, 1, 18, 0).toISOString(), now);
    expect(past).toMatch(/^Added Kickoff · /);
    expect(past).toMatch(/That date has passed/);
  });
  it("names a future event and its time without a false claim", () => {
    const next = addedNote("Build night", new Date(2026, 9, 13, 18, 0).toISOString(), now);
    expect(next).toMatch(/^Added Build night · .+\.$/);
    expect(next).not.toMatch(/Coming up/);
  });
});

describe("calendar-model", () => {
  it("keeps orgId on paths that already have a query", () => {
    expect(withOrg("/logistics", "org-1")).toBe("/logistics?orgId=org-1");
    expect(withOrg("/team?tab=calendar", "org-1")).toBe("/team?tab=calendar&orgId=org-1");
  });

  it("treats a series occurrence as a series event", () => {
    const oneOff = { seriesId: null, isOccurrence: false, rrule: null } as RecurringEvent;
    const series = { seriesId: "s1", isOccurrence: true, rrule: "FREQ=WEEKLY" } as RecurringEvent;
    expect(isSeriesEvent(oneOff)).toBe(false);
    expect(isSeriesEvent(series)).toBe(true);
  });

  it("prints the calendar day without a leading zero", () => {
    expect(dayNum("2026-09-10")).toBe("10");
    expect(dayNum("2026-09-03")).toBe("3");
  });

  describe("fmtRange", () => {
    // Built from local wall-clock so the assertions do not depend on the
    // runner's zone: a 15-minute match cannot straddle midnight either way.
    const at = (y: number, m: number, d: number, h: number, min: number) =>
      new Date(y, m - 1, d, h, min).toISOString();

    it("says the date once when a match starts and ends on the same day", () => {
      const line = fmtRange(at(2026, 9, 17, 7, 45), at(2026, 9, 17, 8, 0));
      const [start, end] = line.split(" → ");
      expect(start).toBe(fmtWhen(at(2026, 9, 17, 7, 45)));
      expect(end).toBe(fmtTime(at(2026, 9, 17, 8, 0)));
      // The date belongs to the start, and appears nowhere after the arrow.
      expect(end).not.toMatch(/Sep/);
    });

    it("keeps both dates when the event ends on another day", () => {
      const line = fmtRange(at(2026, 9, 17, 22, 0), at(2026, 9, 18, 1, 0));
      const [, end] = line.split(" → ");
      expect(end).toBe(fmtWhen(at(2026, 9, 18, 1, 0)));
    });

    it("prints just the start when there is no end", () => {
      const start = at(2026, 9, 17, 7, 45);
      expect(fmtRange(start)).toBe(fmtWhen(start));
      expect(fmtRange(start, null)).toBe(fmtWhen(start));
    });

    it("hands back unparseable input rather than printing Invalid Date", () => {
      expect(fmtRange("not-a-date")).toBe("not-a-date");
      expect(fmtRange("not-a-date", "also-not")).toBe("not-a-date → also-not");
    });
  });
});
