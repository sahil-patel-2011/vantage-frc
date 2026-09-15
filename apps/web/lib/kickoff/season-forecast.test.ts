import { describe, expect, it } from "vitest";
import { expectPlainCopy } from "../ui/copy-assertions";
import {
  analysisModeLabel,
  buildStandardSeasonForecast,
  canRunDeepKickoffAnalysis,
  DEEP_KICKOFF_TEAM_NUMBER,
  deepAnalysisForbiddenMessage,
  forecastToIntelligenceSummary,
  intelligenceAnalysisMode,
  intelligenceSourceLine,
  kickoffIntelligenceEmptyMessage,
  scoringEmptyLine,
} from "./season-forecast";

describe("canRunDeepKickoffAnalysis", () => {
  it("allows only Team 6925", () => {
    expect(canRunDeepKickoffAnalysis(DEEP_KICKOFF_TEAM_NUMBER)).toBe(true);
    expect(canRunDeepKickoffAnalysis(254)).toBe(false);
    expect(canRunDeepKickoffAnalysis(null)).toBe(false);
    expect(canRunDeepKickoffAnalysis(undefined)).toBe(false);
  });
});

describe("buildStandardSeasonForecast", () => {
  it("writes a labeled 2027 guess from official pages without scoring numbers", () => {
    const forecast = buildStandardSeasonForecast(2027);
    expect(forecast.gameName).toBe("BIOCORE");
    expect(forecast.status).toBe("awaiting_manual");
    expect(forecast.guess.join(" ")).toMatch(/BIOCORE/);
    expect(forecast.guess.join(" ")).toMatch(/BIOBUZZ/);
    expect(forecast.ftcCompare.join(" ")).toMatch(/CANOPY/);
    expect(forecast.leakVsActual.length).toBeGreaterThanOrEqual(3);
    expect(forecast.manuals.some((manual) => manual.href.includes("firstinspires.org"))).toBe(true);
    expect(forecast.manuals.some((manual) => manual.href.includes("2026GameManual.pdf"))).toBe(true);
    expect(forecast.manuals.some((manual) => manual.href.includes("ftc/archive/2027/game/manual"))).toBe(true);

    const blob = [
      forecast.overview,
      forecast.disclaimer,
      ...forecast.guess,
      ...forecast.leakLessons,
      ...forecast.ftcCompare,
      ...forecast.leakVsActual.flatMap((row) => [row.publicBeforeKickoff, row.whatShipped]),
    ].join("\n");
    expect(blob).not.toMatch(/\b\d{1,3}\s*(?:pts?|points?)\b/i);
    expectPlainCopy(forecast.overview);
    expectPlainCopy(forecast.disclaimer);
    for (const line of [...forecast.guess, ...forecast.leakLessons, ...forecast.ftcCompare]) {
      expectPlainCopy(line);
    }

    const summary = forecastToIntelligenceSummary(forecast);
    expect(summary.scoring).toEqual([]);
    expect(summary.provenance.analysisMode).toBe("standard");
    expect(intelligenceAnalysisMode(summary)).toBe("standard");
    expect(summary.forecast?.guess.length).toBeGreaterThan(0);
  });

  it("tells a published year to use the official manual", () => {
    const forecast = buildStandardSeasonForecast(2026);
    expect(forecast.gameName).toBe("REBUILT");
    expect(forecast.status).toBe("published");
    expect(forecast.guess.join(" ")).toMatch(/published FRC manual/i);
    expectPlainCopy(forecast.overview);
  });
});

describe("student analysis copy", () => {
  it("stays readable for standard vs deep gates", () => {
    expect(analysisModeLabel("standard")).toBe("Standard analysis");
    expect(analysisModeLabel("deep")).toBe("Deep analysis");
    expectPlainCopy(kickoffIntelligenceEmptyMessage(false));
    expectPlainCopy(kickoffIntelligenceEmptyMessage(true));
    expectPlainCopy(deepAnalysisForbiddenMessage());
    expectPlainCopy(intelligenceSourceLine("standard"));
    expectPlainCopy(intelligenceSourceLine("deep"));
    expectPlainCopy(scoringEmptyLine("standard"));
    expectPlainCopy(scoringEmptyLine("deep"));
    expect(deepAnalysisForbiddenMessage()).toMatch(/6925/);
    expect(kickoffIntelligenceEmptyMessage(true)).toMatch(/6925/);
    expect(kickoffIntelligenceEmptyMessage(false)).not.toMatch(/6925/);
  });
});
