import { describe, expect, it } from "vitest";
import { competitionDay, dateSchedule, organizerEvent, organizerEvents, parseCompetitionSchedule, parseEventYear, plannedLastDay } from "./event-planning";

describe("competition planning", () => {
  it("finds organizer-published GRITS dates without inventing next year's dates", () => {
    expect(organizerEvents(2026, "GRITS", [])).toHaveLength(1);
    expect(organizerEvents(2026, "gainesville", [])[0]).toMatchObject({ startDate: "2026-10-15", endDate: "2026-10-17", sourceUrl: "https://gafirst.org/events/grits-2026" });
    expect(organizerEvents(2027, "GRITS", [])).toEqual([]);
    expect(organizerEvents(2026, "not-an-event", [])).toEqual([]);
  });
  it("keeps a saved team event instead of showing the organizer suggestion twice", () => {
    const grits = organizerEvent("grits-2026")!;
    expect(organizerEvents(2026, "", [{ ...grits, eventKey: "2026custom-12345678-grits", name: "GRITS" }])).toEqual([]);
  });
  it.each(["2026.5", "NaN", "1991", "2101", "", "2026abc"])("rejects invalid season %s", value => {
    expect(() => parseEventYear(value)).toThrow(/season/);
  });
  it("supports future seasons", () => { expect(parseEventYear("2028")).toBe(2028); });
  it("uses the event zone and includes the last day, across DST", () => {
    const fall = dateSchedule("2026-11-01", "2026-11-01", true, "America/New_York");
    expect(fall.startsAt).toBe("2026-11-01T04:00:00.000Z");
    expect(fall.endsAt).toBe("2026-11-02T05:00:00.000Z");
    expect(plannedLastDay(fall.endsAt, fall.timeZone)).toBe("2026-11-01");
    expect(competitionDay(fall.startsAt, fall.timeZone)).toBe("2026-11-01");
    const spring = dateSchedule("2026-03-08", "2026-03-08", false, "America/New_York");
    expect(Date.parse(spring.endsAt) - Date.parse(spring.startsAt)).toBe(23 * 3600000);
    expect(spring.autoActivate).toBe(false);
  });
  it("rejects malformed times, bad zones and unsupported spans", () => {
    const valid = dateSchedule("2026-10-15", "2026-10-17", true, "America/New_York");
    for (const patch of [{ startsAt: "2026-02-31T00:00:00Z" }, { endsAt: valid.startsAt }, { timeZone: "unknown" }, { autoActivate: "true" }, { endsAt: "2027-01-01T00:00:00Z" }]) {
      expect(() => parseCompetitionSchedule({ ...valid, ...patch })).toThrow();
    }
    expect(() => dateSchedule("2026-02-31", "", true)).toThrow();
    expect(() => dateSchedule("2026-10-17", "2026-10-15", true)).toThrow();
    expect(() => dateSchedule("2026-10-15", "", true, "America/NewYork")).toThrow(/time zone/);
  });
});
