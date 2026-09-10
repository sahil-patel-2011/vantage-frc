import { describe, expect, it } from "vitest";
import { elapsedLabel, fmtHours } from "./hours-model";

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
