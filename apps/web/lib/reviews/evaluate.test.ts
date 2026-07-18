import { describe, expect, it } from "vitest";
import { evaluateReview, stageBlueprint, summarizeReviews } from "./evaluate";
import type { DesignReview, ItemVerdict, ReviewItem, ReviewStage } from "./types";

let seq = 0;
function item(verdict: ItemVerdict, blocking = false): ReviewItem {
  seq += 1;
  return { id: `i-${seq}`, criterion: `Criterion ${seq}`, verdict, blocking, notes: null };
}

let rseq = 0;
function review(items: ReviewItem[], overrides: Partial<DesignReview> = {}): DesignReview {
  rseq += 1;
  return {
    id: `r-${rseq}`,
    title: `Review ${rseq}`,
    subsystem: "drivetrain",
    stage: "critical" as ReviewStage,
    status: "in_review",
    scheduledOn: "2026-02-10",
    reviewers: null,
    items,
    notes: null,
    seasonYear: 2026,
    createdAt: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

describe("evaluateReview gate logic", () => {
  it("is a go when every applicable item passes", () => {
    const e = evaluateReview(review([item("pass"), item("pass"), item("na")]));
    expect(e.gate).toBe("go");
    expect(e.applicable).toBe(2);
    expect(e.readiness).toBe(1);
  });

  it("is pending while any item is unresolved", () => {
    const e = evaluateReview(review([item("pass"), item("pending")]));
    expect(e.gate).toBe("pending");
  });

  it("is conditional when a non-blocking item fails but nothing blocks", () => {
    const e = evaluateReview(review([item("pass"), item("fail", false)]));
    expect(e.gate).toBe("conditional");
    expect(e.blockingFails).toBe(0);
  });

  it("is a no-go when a blocking item fails, even with others passing", () => {
    const e = evaluateReview(review([item("pass"), item("pass"), item("fail", true)]));
    expect(e.gate).toBe("no_go");
    expect(e.blockingFails).toBe(1);
  });

  it("no-go beats pending (a blocking fail dominates)", () => {
    const e = evaluateReview(review([item("pending"), item("fail", true)]));
    expect(e.gate).toBe("no_go");
  });

  it("computes readiness as passed / applicable, ignoring N/A", () => {
    const e = evaluateReview(review([item("pass"), item("pass"), item("fail"), item("na")]));
    expect(e.applicable).toBe(3);
    expect(e.readiness).toBeCloseTo(0.667, 2);
  });

  it("an empty checklist is pending, not a go", () => {
    expect(evaluateReview(review([])).gate).toBe("pending");
  });
});

describe("summarizeReviews", () => {
  it("is all-zero for no reviews", () => {
    const s = summarizeReviews([]);
    expect(s.total).toBe(0);
    expect(s.byGate.go).toBe(0);
    expect(s.needsAttention).toEqual([]);
    expect(s.avgReadiness).toBe(0);
  });

  it("counts by stage and gate and surfaces no-go first", () => {
    const s = summarizeReviews([
      review([item("pass")], { stage: "final" }),
      review([item("fail", true)], { stage: "critical" }),
      review([item("pending")], { stage: "critical" }),
    ]);
    expect(s.byStage.critical).toBe(2);
    expect(s.byStage.final).toBe(1);
    expect(s.byGate.no_go).toBe(1);
    expect(s.byGate.go).toBe(1);
    expect(s.needsAttention[0]?.gate).toBe("no_go"); // no-go ranked before pending
    expect(s.needsAttention).toHaveLength(2);
  });

  it("orders upcoming reviews by scheduled date", () => {
    const s = summarizeReviews([
      review([item("pending")], { status: "scheduled", scheduledOn: "2026-03-01" }),
      review([item("pending")], { status: "scheduled", scheduledOn: "2026-02-01" }),
      review([item("pass")], { status: "complete", scheduledOn: "2026-01-01" }),
    ]);
    expect(s.upcoming.map((e) => e.review.scheduledOn)).toEqual(["2026-02-01", "2026-03-01"]);
  });
});

describe("stageBlueprint", () => {
  it("provides a non-empty checklist with blockers for each stage", () => {
    for (const stage of ["concept", "preliminary", "critical", "final"] as ReviewStage[]) {
      const bp = stageBlueprint(stage);
      expect(bp.length).toBeGreaterThan(0);
      expect(bp.some((i) => i.blocking)).toBe(true);
    }
  });
});
