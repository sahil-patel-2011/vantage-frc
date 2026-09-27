import { describe, expect, it } from "vitest";
import { assertMinimumAge, meetsMinimumAge } from "./eligibility";

describe("age eligibility", () => {
  const today = new Date("2026-09-26T23:59:59Z");
  it("accepts the thirteenth birthday and rejects the day before", () => {
    expect(meetsMinimumAge(new Date("2013-09-26"), today)).toBe(true);
    expect(meetsMinimumAge(new Date("2013-09-27"), today)).toBe(false);
    expect(() => assertMinimumAge(new Date("2013-09-27"), today)).toThrow("13 and older");
  });
  it("handles leap birthdays and invalid dates", () => {
    expect(meetsMinimumAge(new Date("2012-02-29"), new Date("2025-02-28"))).toBe(false);
    expect(meetsMinimumAge(new Date("2012-02-29"), new Date("2025-03-01"))).toBe(true);
    expect(meetsMinimumAge(new Date("invalid"), today)).toBe(false);
    expect(meetsMinimumAge(new Date("2010-01-01"), new Date("invalid"))).toBe(false);
  });
});
