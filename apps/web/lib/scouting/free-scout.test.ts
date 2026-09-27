import { describe, expect, it } from "vitest";
import { freeScoutDefinition, parseFreeScoutReport } from "./free-scout";

const base = { id: "aa000000-0000-4000-8000-000000000001", year: 2026, type: "pit", teamNumber: 6925, label: "Practice 1", observedAt: "2026-09-27T12:00:00Z", payload: {} };

describe("scouting without an event", () => {
  it("accepts real match observations without an event, preserving recorded zero and missing answers", () => {
    const result = parseFreeScoutReport({ ...base, type: "match", payload: { auto_fuel: 0, teleop_fuel: 2, notes: "No collection observed" } });
    expect(result).not.toHaveProperty("eventKey");
    expect(result.payload.auto_fuel).toBe(0);
    expect(result.payload).not.toHaveProperty("fuel_passed");
  });
  it("excludes media, identity overrides, and unknown fields", () => {
    const result = parseFreeScoutReport({ ...base, payload: { robot_images: ["media-id"], scout_name: "Another person", made_up_metric: 100 } });
    expect(result.payload).toEqual({});
    expect(freeScoutDefinition(2026, "pit").fields.some((field) => field.type === "robot_image")).toBe(false);
  });
  it.each([{ teamNumber: 0 }, { teamNumber: 999999 }, { year: 0 }, { label: " " }, { id: "not-an-id" }, { observedAt: "invalid" }, { type: "video" }, { payload: [] }])("rejects invalid report identity: %j", (patch) => {
    expect(() => parseFreeScoutReport({ ...base, ...patch })).toThrow();
  });
  it("rejects over-sized text instead of truncating", () => {
    expect(() => parseFreeScoutReport({ ...base, payload: { notes: "x".repeat(65_000) } })).toThrow("too large");
  });
});
