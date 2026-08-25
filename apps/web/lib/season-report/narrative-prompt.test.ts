import { describe, expect, it } from "vitest";
import { buildSeasonNarrativePrompt } from "./narrative-prompt";
import type { SeasonReportNarrative } from "./types";

const NARRATIVE: SeasonReportNarrative = {
  buildReliability: "2 build & reliability entries logged (1 positive, 1 needing attention).",
  results: "1 results entry logged (1 positive, 0 needing attention).",
  budget: "No budget entries logged.",
  outreach: "No outreach entries logged.",
  lessons: "1 lessons entry logged (0 positive, 1 needing attention).",
};

describe("buildSeasonNarrativePrompt", () => {
  it("grounds the prompt in the computed narrative, highlights, and watchouts only", () => {
    const prompt = buildSeasonNarrativePrompt({
      seasonYear: 2026,
      narrative: NARRATIVE,
      highlights: ["Results: Won quals tiebreaker"],
      watchouts: ["Lessons: Chain tensioner slipped twice"],
      entryCount: 4,
    });
    expect(prompt).not.toBeNull();
    expect(prompt).toContain("2026");
    expect(prompt).toContain("Build & reliability: 2 build & reliability entries");
    expect(prompt).toContain("Won quals tiebreaker");
    expect(prompt).toContain("Chain tensioner slipped twice");
    expect(prompt).toContain("ONLY source of truth");
    expect(prompt).toContain("do not invent numbers");
  });

  it("returns null with zero entries — never asks a model to invent a season", () => {
    expect(
      buildSeasonNarrativePrompt({
        seasonYear: 2026,
        narrative: NARRATIVE,
        highlights: [],
        watchouts: [],
        entryCount: 0,
      }),
    ).toBeNull();
  });

  it("states explicitly when no highlights or watchouts were logged", () => {
    const prompt = buildSeasonNarrativePrompt({
      seasonYear: 2026,
      narrative: NARRATIVE,
      highlights: [],
      watchouts: [],
      entryCount: 2,
    });
    expect(prompt).toContain("Highlights: none logged.");
    expect(prompt).toContain("Watchouts: none logged.");
  });
});
