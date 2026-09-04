import { describe, expect, it } from "vitest";
import {
  canUseDeepGameAnalysis,
  DEEP_GAME_ANALYSIS_TEAM_NUMBER,
  deepAnalysisElapsedCopy,
  deepAnalysisStatusCopy,
} from "./deep-analysis";

describe("deep game analysis team gate", () => {
  it("is only for FRC team 6925", () => {
    expect(DEEP_GAME_ANALYSIS_TEAM_NUMBER).toBe(6925);
    expect(canUseDeepGameAnalysis(6925)).toBe(true);
    expect(canUseDeepGameAnalysis(254)).toBe(false);
    expect(canUseDeepGameAnalysis(null)).toBe(false);
  });

  it("does not claim a finished run is official rules", () => {
    expect(deepAnalysisStatusCopy("completed")).toMatch(/not the official manual/i);
    expect(deepAnalysisStatusCopy("running")).toMatch(/continuously/i);
    expect(deepAnalysisStatusCopy(null)).toMatch(/no deep analysis/i);
  });

  it("describes wall-clock progress, not scheduled hours", () => {
    expect(deepAnalysisElapsedCopy(null, 5)).toMatch(/continuously for 5 hours/i);
    expect(deepAnalysisElapsedCopy("2026-09-02T12:00:00.000Z", 5)).toMatch(/of 5 hours/i);
  });
});
