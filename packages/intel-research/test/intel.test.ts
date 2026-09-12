import { describe, expect, it } from "vitest";
import {
  allianceChemistry,
  deriveFoulRisk,
  deriveReliability,
  headToHead,
  historicalTrajectory,
  robotArchetypes,
  scoreAllianceChemistry,
} from "../src/analytics";
import { FixtureSearchProvider, LocalSummaryProvider, isLiveResearchSearchConfigured } from "../src/providers";
import { canonicalizeUrl } from "../src/worker";

describe("Intel analytics", () => {
  const metrics = [
    { year: 2025, epaTotal: 10, epaAuto: 3, epaTeleop: 5, epaEndgame: 2, source: "fixture" },
    { year: 2026, epaTotal: 14, epaAuto: 5, epaTeleop: 7, epaEndgame: 2, source: "fixture" },
  ];
  it("derives trajectory, archetypes, comparisons, and chemistry", () => {
    expect(historicalTrajectory(metrics)).toEqual([{ year: 2025, epa: 10 }, { year: 2026, epa: 14 }]);
    expect(robotArchetypes(metrics.slice().reverse(), [])).toContain("autonomous specialist");
    expect(headToHead(metrics[1], metrics[0])[0]).toMatchObject({ advantage: "a" });
    expect(allianceChemistry(metrics).totalEpa).toBe(24);
    expect(allianceChemistry(metrics).modelVersion).toBe("alliance-chemistry-v1");
  });

  it("scores complementary roles higher than triple overlap", () => {
    const complementary = scoreAllianceChemistry([
      {
        teamKey: "frc1",
        metric: { year: 2026, epaTotal: 40, epaAuto: 16, epaTeleop: 16, epaEndgame: 8, source: "statbotics" },
      },
      {
        teamKey: "frc2",
        metric: { year: 2026, epaTotal: 38, epaAuto: 6, epaTeleop: 24, epaEndgame: 8, source: "statbotics" },
      },
      {
        teamKey: "frc3",
        metric: { year: 2026, epaTotal: 36, epaAuto: 5, epaTeleop: 14, epaEndgame: 17, source: "statbotics" },
      },
    ]);
    const overlap = scoreAllianceChemistry([
      {
        teamKey: "frc1",
        metric: { year: 2026, epaTotal: 40, epaAuto: 6, epaTeleop: 28, epaEndgame: 6, source: "statbotics" },
      },
      {
        teamKey: "frc2",
        metric: { year: 2026, epaTotal: 38, epaAuto: 5, epaTeleop: 27, epaEndgame: 6, source: "statbotics" },
      },
      {
        teamKey: "frc3",
        metric: { year: 2026, epaTotal: 36, epaAuto: 4, epaTeleop: 26, epaEndgame: 6, source: "statbotics" },
      },
    ]);
    expect(complementary.score!).toBeGreaterThan(overlap.score!);
    expect(complementary.caveats[0]).toMatch(/alliance fit/i);
  });

  it("requires evidence before assigning foul risk", () => {
    expect(deriveFoulRisk([{ payload: { fouls: 3 }, confidence: "high" }]).level).toBe("unknown");
    expect(deriveFoulRisk(Array.from({ length: 3 }, () => ({ payload: { fouls: 2 }, confidence: "normal" }))).level).toBe("high");
  });

  it("derives reliability from scouting flags", () => {
    const result = deriveReliability([
      { payload: { cycles: 5 }, confidence: "high" },
      { payload: { cycles: 6, disabled: true }, confidence: "normal" },
    ]);
    expect(result.score).toBe(50);
    expect(result.sampleSize).toBe(2);
  });
});

describe("deterministic providers and provenance", () => {
  it("uses fixtures without credentials and strips tracking from canonical URLs", async () => {
    const provider = new FixtureSearchProvider({
      "team 254": [{ url: "https://example.com/post?utm_source=x", title: "Post", snippet: "A report" }],
    });
    expect(await provider.search("team 254 robot", { limit: 5 })).toHaveLength(1);
    expect(canonicalizeUrl("https://EXAMPLE.com/post/?utm_source=x#section")).toBe("https://example.com/post");
  });

  it("labels qualitative findings and never promotes them to metrics", async () => {
    const summary = await new LocalSummaryProvider().summarize({
      teamNumber: 1,
      nickname: "Test",
      metrics: [],
      findings: [{
        sourceUrl: "https://example.com",
        sourceType: "other",
        summary: "Unverified claim.",
        confidence: 0.7,
        publishedAt: null,
        foundAt: new Date(),
        extractedFacts: [],
      }],
      scoutObservations: [],
    });
    expect(summary.text).toContain("verify at the linked sources");
    expect(summary.model).toBe("vantage-local-summary-v1");
  });

  it("treats missing search credentials as fixture-only, not a live provider", () => {
    const previous = {
      endpoint: process.env.RESEARCH_SEARCH_ENDPOINT,
      key: process.env.RESEARCH_SEARCH_API_KEY,
    };
    delete process.env.RESEARCH_SEARCH_ENDPOINT;
    delete process.env.RESEARCH_SEARCH_API_KEY;
    try {
      expect(isLiveResearchSearchConfigured()).toBe(false);
    } finally {
      if (previous.endpoint == null) delete process.env.RESEARCH_SEARCH_ENDPOINT;
      else process.env.RESEARCH_SEARCH_ENDPOINT = previous.endpoint;
      if (previous.key == null) delete process.env.RESEARCH_SEARCH_API_KEY;
      else process.env.RESEARCH_SEARCH_API_KEY = previous.key;
    }
  });
});

describe("scheduled research sweep", () => {
  it("does not open a database or enqueue fixture jobs when no search provider is configured", async () => {
    const previous = {
      endpoint: process.env.RESEARCH_SEARCH_ENDPOINT,
      key: process.env.RESEARCH_SEARCH_API_KEY,
    };
    delete process.env.RESEARCH_SEARCH_ENDPOINT;
    delete process.env.RESEARCH_SEARCH_API_KEY;
    try {
      const { runScheduledResearchSweep } = await import("../src/production-worker");
      await expect(runScheduledResearchSweep()).resolves.toEqual({
        skipped: true,
        reason: "search_provider_unset",
        processed: 0,
      });
    } finally {
      if (previous.endpoint == null) delete process.env.RESEARCH_SEARCH_ENDPOINT;
      else process.env.RESEARCH_SEARCH_ENDPOINT = previous.endpoint;
      if (previous.key == null) delete process.env.RESEARCH_SEARCH_API_KEY;
      else process.env.RESEARCH_SEARCH_API_KEY = previous.key;
    }
  });
});
