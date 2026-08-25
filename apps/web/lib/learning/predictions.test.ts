import { describe, expect, it } from "vitest";
import {
  detectMisconception,
  explainDelta,
  formatCallNumber,
  parseLearningPrediction,
  scoreCallYourShot,
  summarizeAccuracyTrend,
  type PastCall,
  type TermContribution,
} from "./predictions";

describe("scoreCallYourShot", () => {
  it("grades an exact call as spot on", () => {
    const score = scoreCallYourShot({ predicted: 6.75, actual: 6.75, unit: ":1" });
    expect(score.closeness).toBe("spot-on");
    expect(score.percentError).toBe(0);
    expect(score.direction).toBe("exact");
    expect(score.verdict).toContain("Spot on");
  });

  it("uses the surface's tolerance for the spot-on band", () => {
    // 2% off: spot on at a 5% tolerance, only "close" at a 1% one.
    expect(scoreCallYourShot({ predicted: 102, actual: 100, tolerance: 0.05 }).closeness).toBe("spot-on");
    expect(scoreCallYourShot({ predicted: 102, actual: 100, tolerance: 0.01 }).closeness).toBe("close");
  });

  it("calls anything past three times the tolerance off", () => {
    const score = scoreCallYourShot({ predicted: 130, actual: 100, tolerance: 0.05 });
    expect(score.closeness).toBe("off");
    expect(score.percentError).toBe(30);
    expect(score.direction).toBe("high");
    expect(score.verdict).toContain("30% high");
  });

  it("reports low calls with a negative percent error", () => {
    const score = scoreCallYourShot({ predicted: 80, actual: 100 });
    expect(score.percentError).toBe(-20);
    expect(score.direction).toBe("low");
    expect(score.verdict).toContain("20% low");
  });

  it("falls back to an absolute band when the truth is zero", () => {
    expect(scoreCallYourShot({ predicted: 0, actual: 0 }).closeness).toBe("spot-on");
    expect(scoreCallYourShot({ predicted: 2, actual: 0 }).closeness).toBe("off");
    expect(scoreCallYourShot({ predicted: 2, actual: 0, absoluteTolerance: 2 }).closeness).toBe("spot-on");
    expect(scoreCallYourShot({ predicted: 2, actual: 0 }).percentError).toBeNull();
  });

  it("refuses to score a non-numeric call rather than inventing a grade", () => {
    expect(() => scoreCallYourShot({ predicted: Number.NaN, actual: 5 })).toThrow(/real number/);
    expect(() => scoreCallYourShot({ predicted: 5, actual: Number.NaN })).toThrow(/computed result/);
  });
});

describe("explainDelta", () => {
  const inputs = { label: "the output speed", unit: " RPM" };

  it("names the mis-assumed term, its direction and its leverage", () => {
    const terms: TermContribution[] = [
      { term: "reduction", label: "the compound reduction", assumed: 5, actual: 6.5, influence: 400, unit: ":1" },
      { term: "freeSpeed", label: "the motor free speed you entered", assumed: 6000, actual: 6000, influence: 92, unit: " RPM" },
    ];
    const result = explainDelta(inputs, 1200, 923, terms);
    expect(result.dominantTerm).toBe("reduction");
    expect(result.direction).toBe("high");
    expect(result.sentence).toContain("The motor free speed you entered was right");
    expect(result.sentence).toContain("the compound reduction you assumed (5:1)");
    expect(result.sentence).toContain("23% low");
  });

  it("picks the highest-leverage term when more than one was mis-assumed", () => {
    const terms: TermContribution[] = [
      { term: "small", label: "a small term", assumed: 1, actual: 2, influence: 5 },
      { term: "big", label: "the big term", assumed: 10, actual: 20, influence: 500 },
    ];
    expect(explainDelta(inputs, 10, 20, terms).dominantTerm).toBe("big");
  });

  it("names the biggest lever when no term's assumption is knowable", () => {
    const terms: TermContribution[] = [
      { term: "stage:12:60", label: "the 12:60 stage (×5)", assumed: null, actual: 5, influence: 8 },
      { term: "stage:24:36", label: "the 24:36 stage (×1.5)", assumed: null, actual: 1.5, influence: 3 },
    ];
    const result = explainDelta({ label: "the compound reduction", unit: ":1" }, 5, 7.5, terms);
    expect(result.dominantTerm).toBe("stage:12:60");
    expect(result.sentence).toContain("most leverage");
    expect(result.sentence).toContain("the 12:60 stage");
  });

  it("says so plainly when the call matched", () => {
    const result = explainDelta(inputs, 900, 900, []);
    expect(result.direction).toBe("exact");
    expect(result.sentence).toContain("matched the math exactly");
  });

  it("falls back to a bare gap sentence with no usable terms", () => {
    const result = explainDelta(inputs, 900, 1000, []);
    expect(result.dominantTerm).toBeNull();
    expect(result.sentence).toContain("You called 900 RPM");
    expect(result.sentence).toContain("10% low");
  });

  it("produces the same sentence for the same inputs every time", () => {
    const terms: TermContribution[] = [
      { term: "reduction", label: "the compound reduction", assumed: 5, actual: 6.5, influence: 400, unit: ":1" },
    ];
    expect(explainDelta(inputs, 1200, 923, terms)).toEqual(explainDelta(inputs, 1200, 923, terms));
  });
});

describe("detectMisconception", () => {
  const candidates = [
    { id: "inverse", value: 0.2, explanation: "That is the inverse." },
    { id: "sum", value: 6.5, explanation: "Stage ratios multiply." },
  ];

  it("matches the specific wrong method the student used", () => {
    expect(detectMisconception(candidates, 0.2, 5)?.id).toBe("inverse");
    expect(detectMisconception(candidates, 6.55, 5)?.id).toBe("sum");
  });

  it("returns null when the call matches no known wrong method", () => {
    expect(detectMisconception(candidates, 3.1, 5)).toBeNull();
  });

  it("never attributes a method that would have produced the right answer anyway", () => {
    const same = [{ id: "same", value: 5.01, explanation: "coincidence" }];
    expect(detectMisconception(same, 5.01, 5)).toBeNull();
  });

  it("prefers the closest matching method", () => {
    const near = [
      { id: "a", value: 10, explanation: "a" },
      { id: "b", value: 10.15, explanation: "b" },
    ];
    expect(detectMisconception(near, 10.14, 4, 0.02)?.id).toBe("b");
  });
});

describe("summarizeAccuracyTrend", () => {
  const call = (closeness: PastCall["closeness"], skipped = false): PastCall => ({
    closeness,
    skipped,
    createdAt: "2026-02-01T00:00:00.000Z",
  });

  it("has an honest empty state instead of a zeroed chart", () => {
    const trend = summarizeAccuracyTrend([]);
    expect(trend.total).toBe(0);
    expect(trend.accuracy).toBeNull();
    expect(trend.direction).toBe("unknown");
    expect(trend.headline).toContain("No calls yet");
  });

  it("counts only the most recent window", () => {
    const trend = summarizeAccuracyTrend(Array.from({ length: 9 }, () => call("spot-on")), 5);
    expect(trend.total).toBe(5);
    expect(trend.spotOn).toBe(5);
    expect(trend.accuracy).toBe(1);
  });

  it("keeps skips out of the accuracy score but reports them", () => {
    const trend = summarizeAccuracyTrend([call(null, true), call("off"), call("spot-on")]);
    expect(trend.skipped).toBe(1);
    expect(trend.scored).toBe(2);
    expect(trend.accuracy).toBe(0.5);
  });

  it("says nothing is scored when every call was skipped", () => {
    const trend = summarizeAccuracyTrend([call(null, true), call(null, true)]);
    expect(trend.accuracy).toBeNull();
    expect(trend.headline).toContain("skipped");
  });

  it("reads improvement from newest-first ordering", () => {
    // Newest first: two spot-on now, two off before.
    const trend = summarizeAccuracyTrend([call("spot-on"), call("spot-on"), call("off"), call("off")]);
    expect(trend.direction).toBe("improving");
    expect(trend.headline).toContain("Trending better");
  });

  it("flags a slipping student for a mentor", () => {
    const trend = summarizeAccuracyTrend([call("off"), call("off"), call("spot-on"), call("spot-on")]);
    expect(trend.direction).toBe("slipping");
    expect(trend.headline).toContain("mentor");
  });

  it("stays unknown until there is enough scored history", () => {
    expect(summarizeAccuracyTrend([call("spot-on"), call("off")]).direction).toBe("unknown");
  });
});

describe("parseLearningPrediction", () => {
  const base = {
    orgId: "11111111-1111-1111-1111-111111111111",
    surface: "gearbox",
    inputs: { stages: [] },
    predicted: { reduction: 5 },
    actual: { reduction: 6.75 },
    closeness: "off",
  };

  it("accepts a graded call", () => {
    const parsed = parseLearningPrediction(base);
    expect(parsed.orgId).toBe(base.orgId);
    expect(parsed.record.surface).toBe("gearbox");
    expect(parsed.record.closeness).toBe("off");
    expect(parsed.record.skipped).toBe(false);
  });

  it("accepts a skip with no closeness", () => {
    const parsed = parseLearningPrediction({ ...base, closeness: null, predicted: {}, skipped: true });
    expect(parsed.record.skipped).toBe(true);
    expect(parsed.record.closeness).toBeNull();
  });

  it("rejects an ungraded, unskipped call", () => {
    expect(() => parseLearningPrediction({ ...base, closeness: null })).toThrow(/closeness/);
    expect(() => parseLearningPrediction({ ...base, closeness: "great" })).toThrow(/closeness/);
  });

  it("rejects a missing org, a bad surface and a non-object payload", () => {
    expect(() => parseLearningPrediction({ ...base, orgId: "" })).toThrow(/orgId/);
    expect(() => parseLearningPrediction({ ...base, surface: "cad" })).toThrow(/surface/);
    expect(() => parseLearningPrediction(null)).toThrow(/Invalid request body/);
    expect(() => parseLearningPrediction({ ...base, inputs: [1, 2] })).toThrow(/inputs must be an object/);
  });
});

describe("formatCallNumber", () => {
  it("keeps small numbers precise and large ones readable", () => {
    expect(formatCallNumber(6.7532)).toBe("6.753");
    expect(formatCallNumber(1234.56)).toBe("1234.6");
    expect(formatCallNumber(Number.NaN)).toBe("—");
  });
});
