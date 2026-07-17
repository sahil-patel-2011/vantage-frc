import { describe, expect, it } from "vitest";
import { AWARD_CATALOG, awardCatalogEntry, awardStatusLabel, summarizeAwardHistory } from "./awards";

describe("award catalog", () => {
  it("includes Chairman's Award with essay prompts", () => {
    const entry = awardCatalogEntry("chairmans");
    expect(entry?.name).toBe("Chairman's Award");
    expect(entry?.essayPrompts.length).toBeGreaterThan(0);
  });

  it("has a unique slug for every catalog entry", () => {
    const slugs = AWARD_CATALOG.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("returns undefined for an unknown slug", () => {
    expect(awardCatalogEntry("not-a-real-award")).toBeUndefined();
  });
});

describe("award history summary", () => {
  it("counts wins and lists which awards were won", () => {
    const summary = summarizeAwardHistory([
      { seasonYear: 2025, awardType: "safety", status: "won" },
      { seasonYear: 2025, awardType: "chairmans", status: "finalist" },
      { seasonYear: 2026, awardType: "impact", status: "submitted" },
    ]);
    expect(summary.totalWon).toBe(1);
    expect(summary.wonAwardNames).toContain("Safety Award");
    expect(summary.seasonsActive).toEqual([2026, 2025]);
  });
});

describe("award status labels", () => {
  it("labels every status", () => {
    for (const status of ["planned", "drafting", "in_review", "submitted", "finalist", "won", "not_selected"] as const) {
      expect(awardStatusLabel(status).length).toBeGreaterThan(0);
    }
  });
});
