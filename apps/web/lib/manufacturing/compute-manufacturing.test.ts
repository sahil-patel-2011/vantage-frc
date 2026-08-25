import { describe, expect, it } from "vitest";
import { defaultSeasonYear, todayIso } from "./compute-manufacturing";

describe("defaultSeasonYear", () => {
  it("uses the calendar year through August", () => {
    expect(defaultSeasonYear(new Date(Date.UTC(2026, 0, 15)))).toBe(2026);
    expect(defaultSeasonYear(new Date(Date.UTC(2026, 7, 31)))).toBe(2026);
  });

  it("rolls to the next game year from September onward", () => {
    expect(defaultSeasonYear(new Date(Date.UTC(2026, 8, 1)))).toBe(2027);
    expect(defaultSeasonYear(new Date(Date.UTC(2026, 11, 31)))).toBe(2027);
  });
});

describe("todayIso", () => {
  it("returns YYYY-MM-DD", () => {
    expect(todayIso(new Date(Date.UTC(2026, 2, 5, 23, 59)))).toBe("2026-03-05");
  });
});
