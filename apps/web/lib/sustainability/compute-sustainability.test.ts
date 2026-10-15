// Node-only unit tests for the season boundary the sustainability reader uses to pick which
// rows count as "this season". Getting this wrong silently compares the wrong two years and
// produces a year-over-year cliff that never happened, so it gets its own test.

import { describe, expect, it } from "vitest";
import { EXPIRY_LOOKAHEAD_DAYS, currentSeasonYear } from "./compute-sustainability";

describe("currentSeasonYear", () => {
  it("names the season by the calendar year, the same rule every page uses", () => {
    expect(currentSeasonYear(new Date("2026-01-05T12:00:00Z"))).toBe(2026);
    expect(currentSeasonYear(new Date("2026-09-01T00:00:00Z"))).toBe(2026);
    expect(currentSeasonYear(new Date("2026-12-31T23:59:59Z"))).toBe(2026);
    expect(currentSeasonYear(new Date("2027-01-15T12:00:00Z"))).toBe(2027);
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
