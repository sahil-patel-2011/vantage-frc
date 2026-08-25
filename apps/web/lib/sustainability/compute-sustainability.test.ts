// Node-only unit tests for the season boundary the sustainability reader uses to pick which
// rows count as "this season". Getting this wrong silently compares the wrong two years and
// produces a year-over-year cliff that never happened, so it gets its own test.

import { describe, expect, it } from "vitest";
import { EXPIRY_LOOKAHEAD_DAYS, currentSeasonYear } from "./compute-sustainability";

describe("currentSeasonYear", () => {
  it("names the season for the championship year", () => {
    // January–August of 2026 is still the 2026 season.
    expect(currentSeasonYear(new Date("2026-01-05T12:00:00Z"))).toBe(2026);
    expect(currentSeasonYear(new Date("2026-04-20T12:00:00Z"))).toBe(2026);
    expect(currentSeasonYear(new Date("2026-08-31T23:59:59Z"))).toBe(2026);
  });

  it("rolls to the next season from September, when the next build cycle starts", () => {
    expect(currentSeasonYear(new Date("2026-09-01T00:00:00Z"))).toBe(2027);
    expect(currentSeasonYear(new Date("2026-12-31T23:59:59Z"))).toBe(2027);
  });

  it("is stable across the calendar new year inside one season", () => {
    const december = currentSeasonYear(new Date("2026-12-15T12:00:00Z"));
    const january = currentSeasonYear(new Date("2027-01-15T12:00:00Z"));
    expect(december).toBe(january);
  });
});

describe("EXPIRY_LOOKAHEAD_DAYS", () => {
  it("looks far enough ahead to act, not so far it cries wolf", () => {
    // Must exceed the widest alert milestone (30 days) so a mentor sees the cliff coming
    // before the first deadline email, and stay under a year so it means "soon".
    expect(EXPIRY_LOOKAHEAD_DAYS).toBeGreaterThan(30);
    expect(EXPIRY_LOOKAHEAD_DAYS).toBeLessThan(365);
  });
});
