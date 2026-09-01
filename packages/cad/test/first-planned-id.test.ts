import { describe, expect, it } from "vitest";
import { firstPlannedId } from "../src/first-planned-id";

describe("firstPlannedId", () => {
  it("returns a plain string unchanged", () => {
    expect(firstPlannedId("JHD")).toBe("JHD");
  });

  it("returns the first entry from a string array", () => {
    expect(firstPlannedId(["JHD"])).toBe("JHD");
    expect(firstPlannedId(["", "  ", "JHD", "other"])).toBe("JHD");
  });

  it("returns empty for blank string or empty array", () => {
    expect(firstPlannedId("")).toBe("");
    expect(firstPlannedId("   ")).toBe("");
    expect(firstPlannedId([])).toBe("");
    expect(firstPlannedId(["", "  "])).toBe("");
    expect(firstPlannedId(undefined)).toBe("");
  });

  it("throws on DEMO tokens", () => {
    expect(() => firstPlannedId("DEMO")).toThrow(/DEMO/i);
    expect(() => firstPlannedId(["DEMO"])).toThrow(/DEMO/i);
    expect(() => firstPlannedId("demo-1")).toThrow(/DEMO/i);
  });
});
