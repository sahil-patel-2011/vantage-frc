import { describe, expect, it } from "vitest";
import { describeBudget, summarizeBudget, usd } from "./compute-budget";
import { describeApprovalImpact } from "../part-requests/compute-part-requests";

describe("budget honesty", () => {
  it("has no remaining figure when no budget is set", () => {
    const summary = summarizeBudget({
      totalBudgetUsd: null,
      recordedSpendUsd: 0,
      recordedRowCount: 0,
    });
    expect(summary.state).toBe("no_budget_no_spend");
    expect(summary.remainingUsd).toBeNull();
    expect(summary.consumedRatio).toBeNull();
  });

  it("shows real spend against no budget without inventing one", () => {
    const summary = summarizeBudget({
      totalBudgetUsd: null,
      recordedSpendUsd: 412.5,
      recordedRowCount: 3,
    });
    expect(summary.state).toBe("no_budget");
    expect(summary.recordedSpendUsd).toBe(412.5);
    expect(summary.remainingUsd).toBeNull();
    expect(describeBudget(summary)).toMatch(/no budget to measure it against/i);
  });

  /**
   * THE ONE THIS FEATURE EXISTS FOR. A $25,000 budget with an empty ledger must
   * not report "$25,000 remaining, 0% used" — that reads as a healthy season
   * when it actually means nobody has entered anything. Two flattering defaults
   * have already shipped here (a readiness score that rose the less a team
   * entered; a battery score that rated an untested pack 100). Not a third.
   */
  it("refuses to report a remaining balance when NOTHING has been recorded", () => {
    const summary = summarizeBudget({
      totalBudgetUsd: 25000,
      recordedSpendUsd: 0,
      recordedRowCount: 0,
    });
    expect(summary.state).toBe("budget_no_spend");
    expect(summary.remainingUsd).toBeNull();
    expect(summary.consumedRatio).toBeNull();
    expect(summary.totalBudgetUsd).toBe(25000);
    expect(describeBudget(summary)).toMatch(/nothing has been entered, not that nothing has been spent/i);
  });

  it("subtracts once a real row exists, even a zero-dollar one", () => {
    const summary = summarizeBudget({
      totalBudgetUsd: 25000,
      recordedSpendUsd: 0,
      recordedRowCount: 1,
    });
    expect(summary.state).toBe("tracking");
    expect(summary.remainingUsd).toBe(25000);
    expect(summary.consumedRatio).toBe(0);
  });

  it("tracks and flags over-budget from real recorded spend", () => {
    const tracking = summarizeBudget({
      totalBudgetUsd: 1000,
      recordedSpendUsd: 250.25,
      recordedRowCount: 4,
    });
    expect(tracking.state).toBe("tracking");
    expect(tracking.remainingUsd).toBe(749.75);
    expect(tracking.consumedRatio).toBeCloseTo(0.25025, 5);

    const over = summarizeBudget({
      totalBudgetUsd: 1000,
      recordedSpendUsd: 1400,
      recordedRowCount: 9,
    });
    expect(over.state).toBe("over");
    expect(over.remainingUsd).toBe(-400);
    expect(describeBudget(over)).toMatch(/over by/i);
  });

  it("never divides by a zero budget", () => {
    const summary = summarizeBudget({
      totalBudgetUsd: 0,
      recordedSpendUsd: 10,
      recordedRowCount: 1,
    });
    expect(summary.state).toBe("over");
    expect(summary.consumedRatio).toBeNull();
    expect(Number.isFinite(summary.remainingUsd ?? NaN)).toBe(true);
  });

  it("rounds money to whole cents rather than carrying float noise", () => {
    expect(usd("0.1")).toBe(0.1);
    expect(usd(1 / 3)).toBe(0.33);
    expect(usd(null)).toBe(0);
    expect(usd("not a number")).toBe(0);
    const summary = summarizeBudget({
      totalBudgetUsd: 100,
      recordedSpendUsd: 33.335,
      recordedRowCount: 1,
    });
    expect(summary.remainingUsd).toBe(66.66);
  });
});

describe("approval impact", () => {
  it("says nothing at all when there is no budget context", () => {
    expect(describeApprovalImpact(null, 60)).toBeNull();
  });

  it("does not imply a remaining balance when nothing is recorded", () => {
    const summary = summarizeBudget({
      totalBudgetUsd: 25000,
      recordedSpendUsd: 0,
      recordedRowCount: 0,
    });
    const line = describeApprovalImpact(summary, 60)!;
    expect(line).toMatch(/first spending recorded/i);
    expect(line).not.toMatch(/would leave/i);
  });

  it("shows what approving leaves once spend is real", () => {
    const summary = summarizeBudget({
      totalBudgetUsd: 1000,
      recordedSpendUsd: 200,
      recordedRowCount: 2,
    });
    expect(describeApprovalImpact(summary, 300)).toMatch(/would leave/i);
  });

  it("is explicit when there is no budget to measure against", () => {
    const summary = summarizeBudget({
      totalBudgetUsd: null,
      recordedSpendUsd: 500,
      recordedRowCount: 5,
    });
    expect(describeApprovalImpact(summary, 60)).toMatch(/no season budget is set/i);
  });
});
