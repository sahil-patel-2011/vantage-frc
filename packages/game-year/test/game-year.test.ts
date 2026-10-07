import { describe, expect, it } from "vitest";
import {
  currentSeasonYear,
  defaultMatchSchema,
  isManualPublished,
  lastPublishedPack,
  packForYear,
} from "../src";

describe("game-year packs", () => {
  it("keeps released/passed fuel separate from scoring and asks about both tower climbs", () => {
    const pack = packForYear(2026);
    expect(pack.scoringKeys).not.toContain("fuel_passed");
    expect(pack.scoringKeys).not.toContain("disabled");
    expect(pack.scoringKeys).toContain("auto_tower_level");
    expect(pack.matchSchema.fields.find(field => field.key === "auto_tower_level")?.options).toEqual(["none", "L1"]);
    expect(pack.matchSchema.fields.find(field => field.key === "tower_level")?.options).toEqual(["none", "L1", "L2", "L3"]);
    expect(pack.matchSchema.fields.find(field => field.key === "auto_fuel")?.config?.requireObservation).toBe(true);
  });
  it("ships published 2026 REBUILT scoring keys", () => {
    const pack = packForYear(2026);
    expect(pack.status).toBe("published");
    expect(pack.scoringKeys).toContain("tower_level");
    expect(defaultMatchSchema(2026).fields.some((field) => field.key === "auto_fuel")).toBe(true);
    expect(defaultMatchSchema(2026).fields.some((field) => field.key === "alliance_station")).toBe(true);
    expect(isManualPublished(2026)).toBe(true);
    const pitKeys = pack.pitSchema.fields.map((field) => field.key);
    expect(pitKeys).toContain("programming_language");
    expect(pitKeys).toContain("driver_seasons");
    expect(pitKeys).not.toContain("fuel_capacity");
    expect(pitKeys).not.toContain("tower_capability");
    expect(pack.brief?.headline).toMatch(/tower/i);
  });

  it("points 2027 at last published REBUILT", () => {
    const prior = lastPublishedPack(2027);
    expect(prior?.year).toBe(2026);
    expect(prior?.gameName).toBe("REBUILT");
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
