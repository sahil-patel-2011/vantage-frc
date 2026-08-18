import { describe, expect, it } from "vitest";
import { classifyEpaRole, fieldEpaBenchmarks, picklistToCsv } from ".";
import type { PicklistCollabEntry } from "./types";

describe("classifyEpaRole", () => {
  it("returns null when EPA totals are missing instead of inventing a role", () => {
    expect(
      classifyEpaRole({
        epaTotal: null,
        epaAuto: 12,
        epaTeleop: 20,
        fieldMedian: 30,
        fieldP75: 50,
      }),
    ).toBeNull();
  });

  it("labels an elite auto specialist from real auto share vs the field p75", () => {
    expect(
      classifyEpaRole({
        epaTotal: 60,
        epaAuto: 28,
        epaTeleop: 20,
        fieldMedian: 35,
        fieldP75: 50,
      }),
    ).toBe("elite_auto");
  });

  it("labels a teleop-heavy primary scorer above the field median", () => {
    expect(
      classifyEpaRole({
        epaTotal: 40,
        epaAuto: 8,
        epaTeleop: 28,
        fieldMedian: 30,
        fieldP75: 55,
      }),
    ).toBe("primary_scorer");
  });
});

describe("fieldEpaBenchmarks", () => {
  it("needs four real totals before computing percentiles", () => {
    expect(fieldEpaBenchmarks([10, 20, 30])).toBeNull();
    expect(fieldEpaBenchmarks([10, 20, 30, 40])?.median).toBe(25);
  });
});

describe("picklistToCsv", () => {
  it("exports one row per team with role and note columns", () => {
    const entries: PicklistCollabEntry[] = [
      {
        id: "1",
        teamNumber: 254,
        teamName: "Cheesy Poofs",
        tier: "first_pick",
        position: 1,
        note: "Ask about auto",
        addedBy: "u",
        votes: [],
        weightedScore: 3,
        averageRankSuggestion: 1,
        epaTotal: 60,
        epaAuto: 28,
        epaTeleop: 20,
        epaRole: "elite_auto",
      },
    ];
    const csv = picklistToCsv({ listName: "Week 3", entries });
    expect(csv).toContain("List,Team,Name,Tier,Role,EPA,Auto EPA,Teleop EPA,Weighted score,Note");
    expect(csv).toContain("Week 3,254,Cheesy Poofs,First pick,Elite auto,60,28,20,3,Ask about auto");
  });
});
