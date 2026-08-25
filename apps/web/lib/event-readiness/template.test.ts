import { describe, expect, it } from "vitest";
import { EVENT_READINESS_TEMPLATE } from "./template";
import { READINESS_CATEGORIES, READINESS_SOURCE_KINDS, ROLLUP_SOURCES } from "./types";

describe("EVENT_READINESS_TEMPLATE", () => {
  it("has only valid categories, source kinds, and non-negative offsets", () => {
    for (const row of EVENT_READINESS_TEMPLATE) {
      expect(READINESS_CATEGORIES).toContain(row.category);
      expect(READINESS_SOURCE_KINDS).toContain(row.sourceKind);
      expect(Number.isInteger(row.daysBefore)).toBe(true);
      expect(row.daysBefore).toBeGreaterThanOrEqual(0);
      expect(row.title.length).toBeGreaterThan(0);
      expect(row.detail.length).toBeGreaterThan(0);
    }
  });

  it("has unique titles", () => {
    const titles = EVENT_READINESS_TEMPLATE.map((row) => row.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("maps one row to each of the four live source systems", () => {
    const mapped = EVENT_READINESS_TEMPLATE.filter((row) =>
      (ROLLUP_SOURCES as readonly string[]).includes(row.sourceKind),
    );
    expect(new Set(mapped.map((row) => row.sourceKind))).toEqual(new Set(ROLLUP_SOURCES));
  });

  it("orders the countdown from far-out to day-before (no offset past two weeks, none negative)", () => {
    const offsets = EVENT_READINESS_TEMPLATE.map((row) => row.daysBefore);
    expect(Math.max(...offsets)).toBeLessThanOrEqual(14);
    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(1);
  });
});
