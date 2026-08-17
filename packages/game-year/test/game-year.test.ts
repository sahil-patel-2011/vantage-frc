import { describe, expect, it } from "vitest";
import {
  currentSeasonYear,
  defaultMatchSchema,
  isManualPublished,
  packForYear,
} from "../src";

describe("game-year packs", () => {
  it("ships published 2026 REBUILT scoring keys", () => {
    const pack = packForYear(2026);
    expect(pack.status).toBe("published");
    expect(pack.scoringKeys).toContain("tower_level");
    expect(defaultMatchSchema(2026).fields.some((field) => field.key === "auto_fuel")).toBe(true);
    expect(defaultMatchSchema(2026).fields.some((field) => field.key === "alliance_station")).toBe(true);
    expect(isManualPublished(2026)).toBe(true);
  });

  it("does not invent 2027 BIOCORE scoring keys before the manual", () => {
    const pack = packForYear(2027);
    expect(pack.status).toBe("awaiting_manual");
    expect(pack.scoringKeys).toEqual([]);
    expect(pack.strategyTemplates).toEqual([]);
    expect(isManualPublished(2027)).toBe(false);
  });

  it("falls back to generic schemas for unknown years", () => {
    const pack = packForYear(2019);
    expect(pack.status).toBe("awaiting_manual");
    expect(pack.matchSchema.fields.some((field) => field.key === "auto_score")).toBe(true);
  });

  it("treats August as the next season year", () => {
    expect(currentSeasonYear(new Date("2026-08-17T12:00:00Z"))).toBe(2027);
    expect(currentSeasonYear(new Date("2027-03-01T12:00:00Z"))).toBe(2027);
  });
});
