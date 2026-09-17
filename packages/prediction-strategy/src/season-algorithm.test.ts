import { describe, expect, it } from "vitest";
import { DEFAULT_LOGISTIC_SCALE } from "./calibration";
import {
  SEASON_ALGORITHMS,
  algorithmForSeason,
  algorithmProvenance,
  newestAlgorithm,
} from "./season-algorithm";

describe("SEASON_ALGORITHMS", () => {
  it("is registered oldest first, so inheritance walks forward", () => {
    const years = SEASON_ALGORITHMS.map((row) => row.fromSeason);
    expect(years).toEqual([...years].sort((a, b) => a - b));
  });

  it("has no two algorithms claiming the same season", () => {
    expect(new Set(SEASON_ALGORITHMS.map((r) => r.fromSeason)).size).toBe(SEASON_ALGORITHMS.length);
    expect(new Set(SEASON_ALGORITHMS.map((r) => r.id)).size).toBe(SEASON_ALGORITHMS.length);
  });

  it("keeps the legacy curve exactly as it was", () => {
    // Predictions stored before any of this must reproduce to the digit. If this
    // number ever changes, old rows silently start disagreeing with themselves.
    const legacy = SEASON_ALGORITHMS.find((row) => row.id === "legacy-fixed-v1")!;
    expect(legacy.logisticScale).toBe(DEFAULT_LOGISTIC_SCALE);
    expect(legacy.shrinkage).toBe(false);
  });

  it("says what is different about each one", () => {
    for (const row of SEASON_ALGORITHMS) {
      expect(row.notes.length, row.id).toBeGreaterThan(40);
      expect(row.label.length, row.id).toBeGreaterThan(0);
    }
  });
});

describe("algorithmForSeason", () => {
  it("picks the row written for that season", () => {
    expect(algorithmForSeason(2026).id).toBe("measured-v1");
    expect(algorithmForSeason(2026).inherited).toBe(false);
  });

  it("inherits forward for a game nobody has tuned for yet", () => {
    const future = algorithmForSeason(2030);
    expect(future.id).toBe(newestAlgorithm().id);
    expect(future.inherited).toBe(true);
    expect(future.requestedSeason).toBe(2030);
  });

  it("never inherits backward", () => {
    // A 2020 match must not be re-scored by maths written for a later game.
    expect(algorithmForSeason(2020).id).toBe("legacy-fixed-v1");
  });

  it("gives a season older than anything registered the oldest row, flagged", () => {
    const ancient = algorithmForSeason(1997);
    expect(ancient.id).toBe(SEASON_ALGORITHMS[0]!.id);
    expect(ancient.inherited).toBe(true);
  });

  it("falls back to the default scale when a game has not been measured", () => {
    const current = algorithmForSeason(2026);
    expect(current.scaleMeasured).toBe(false);
    expect(current.effectiveScale).toBe(DEFAULT_LOGISTIC_SCALE);
  });

  it("does not call an unmeasured scale a measurement", () => {
    // A row with a scale but zero matches behind it is still an assumption.
    const legacy = algorithmForSeason(2020);
    expect(legacy.logisticScale).toBe(DEFAULT_LOGISTIC_SCALE);
    expect(legacy.fittedFrom).toBe(0);
    expect(legacy.scaleMeasured).toBe(false);
  });

  it("survives a season that is not a number", () => {
    expect(() => algorithmForSeason(Number.NaN)).not.toThrow();
    expect(algorithmForSeason(Number.NaN).id.length).toBeGreaterThan(0);
  });

  it("truncates rather than rejecting a fractional year", () => {
    expect(algorithmForSeason(2026.7).id).toBe(algorithmForSeason(2026).id);
  });
});

describe("algorithmProvenance", () => {
  it("admits when the curve was never measured", () => {
    const line = algorithmProvenance(algorithmForSeason(2026));
    expect(line).toMatch(/not measured/i);
    expect(line).toMatch(/pulled toward the field/i);
  });

  it("says when it is running maths written for an earlier game", () => {
    expect(algorithmProvenance(algorithmForSeason(2030))).toMatch(/newest written/i);
  });

  it("warns that the legacy curve takes thin records at face value", () => {
    expect(algorithmProvenance(algorithmForSeason(2020))).toMatch(/face value/i);
  });
});
