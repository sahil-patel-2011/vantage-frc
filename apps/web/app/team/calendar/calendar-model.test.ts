import { describe, expect, it } from "vitest";
import {
  dayNum,
  isSeriesEvent,
  withOrg,
  type RecurringEvent,
} from "./calendar-model";

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
});
