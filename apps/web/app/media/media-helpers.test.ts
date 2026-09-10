import { describe, expect, it } from "vitest";
import { fromLocalInputValue, formatWhen } from "./media-helpers";

describe("media datetime helpers", () => {
  it("treats a blank datetime-local as unset, not a zero date", () => {
    expect(fromLocalInputValue("")).toBeNull();
    expect(fromLocalInputValue("   ")).toBeNull();
    expect(fromLocalInputValue("not-a-date")).toBeNull();
  });

  it("round-trips a datetime-local value to ISO", () => {
    const iso = fromLocalInputValue("2026-03-14T18:05");
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Date.parse(iso ?? "")).toBe(Date.parse("2026-03-14T18:05"));
  });

  it("keeps missing timestamps as an em dash instead of inventing a time", () => {
    expect(formatWhen(null)).toBe("—");
    expect(formatWhen("not-a-date")).toBe("not-a-date");
  });
});
