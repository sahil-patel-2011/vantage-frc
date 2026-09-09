import { describe, expect, it } from "vitest";
import { formatInstant, toIsoInstant } from "./time";

describe("toIsoInstant", () => {
  it("pads the two-digit offset Postgres actually emits", () => {
    // This exact shape shipped as an empty timestamp on every announcement.
    expect(toIsoInstant("2026-09-09 01:23:45.123456-04")).toBe("2026-09-09T01:23:45.123456-04:00");
    expect(Number.isNaN(new Date(toIsoInstant("2026-09-09 01:23:45.123456-04")).getTime())).toBe(false);
  });

  it("leaves an already-valid offset alone", () => {
    expect(toIsoInstant("2026-09-09T01:23:45.000-04:00")).toBe("2026-09-09T01:23:45.000-04:00");
  });

  it("leaves a UTC Z instant alone", () => {
    expect(toIsoInstant("2026-09-09T01:23:45.000Z")).toBe("2026-09-09T01:23:45.000Z");
  });

  it("handles a positive offset", () => {
    expect(toIsoInstant("2026-09-09 01:23:45+05")).toBe("2026-09-09T01:23:45+05:00");
  });

  it("does not mangle a time that has no offset at all", () => {
    expect(toIsoInstant("2026-09-09 01:23:45")).toBe("2026-09-09T01:23:45");
  });
});

describe("formatInstant", () => {
  it("renders something for the Postgres shape rather than nothing", () => {
    expect(formatInstant("2026-09-09 01:23:45.123456-04")).not.toBe("");
  });

  it("returns empty string for junk instead of 'Invalid Date'", () => {
    expect(formatInstant("not a date")).toBe("");
  });
});
