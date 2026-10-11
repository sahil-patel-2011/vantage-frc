import { describe, expect, it } from "vitest";
import { elapsedLabel, fmtClock, fmtDuration, fmtHours, hoursRecordLineHours, toLocalInputValue } from "./hours-model";

describe("entry lines (A5-03, A5-23)", () => {
  it("shows the year on an entry from another year, and not on this year's", () => {
    const now = Date.parse("2026-10-11T18:00:00");
    expect(fmtClock("2027-01-05T10:00:00", now)).toMatch(/2027/);
    expect(fmtClock("2026-10-10T10:00:00", now)).not.toMatch(/2026/);
  });

  it("writes short sessions in minutes instead of 0h", () => {
    expect(fmtDuration(0.3 / 3600)).toBe("under 1 min");
    expect(fmtDuration(0.75)).toBe("45 min");
    expect(fmtDuration(4)).toBe("4h");
    const tapInTapOut = { id: "a", userId: "u", userName: null, kind: "build" as const, note: "", closedByName: null,
      clockIn: "2026-10-11T18:00:00.000Z", clockOut: "2026-10-11T18:00:00.300Z" };
    expect(hoursRecordLineHours(tapInTapOut, Date.now())).toBe("under 1 min");
  });

  it("fills a datetime-local field with the local wall-clock time", () => {
    expect(toLocalInputValue("2026-10-11T18:05:00")).toBe("2026-10-11T18:05");
  });
});

describe("hours-model formatters", () => {
  it("prints whole hours without a decimal", () => {
    expect(fmtHours(4)).toBe("4h");
    expect(fmtHours(1.5)).toBe("1.50h");
  });

  it("formats an open session as h:mm from real clock-in time", () => {
    const clockIn = "2026-09-10T12:00:00.000Z";
    const now = Date.parse("2026-09-10T13:07:00.000Z");
    expect(elapsedLabel(clockIn, now)).toBe("1:07");
    expect(elapsedLabel(clockIn, Date.parse(clockIn) - 1_000)).toBe("0:00");
  });
});
