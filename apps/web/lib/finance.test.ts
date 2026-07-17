import { describe, expect, it } from "vitest";
import { canTransitionPurchaseRequest, summarizeMonthlyBudget, validatePurchaseRequestInput } from "./finance";

describe("purchase request validation", () => {
  it("rejects a missing title", () => {
    expect(validatePurchaseRequestInput({ quantity: 1, unitCostUsd: 10 }).ok).toBe(false);
  });

  it("computes total cost from quantity and unit cost", () => {
    const result = validatePurchaseRequestInput({ title: "Gearbox", quantity: 3, unitCostUsd: 19.99 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.totalCostUsd).toBeCloseTo(59.97);
  });

  it("rejects a negative unit cost", () => {
    expect(validatePurchaseRequestInput({ title: "Gearbox", quantity: 1, unitCostUsd: -5 }).ok).toBe(false);
  });

  it("rejects a malformed item URL", () => {
    expect(
      validatePurchaseRequestInput({ title: "Gearbox", quantity: 1, unitCostUsd: 5, itemUrl: "not-a-url" }).ok,
    ).toBe(false);
  });

  it("defaults vendor to amazon", () => {
    const result = validatePurchaseRequestInput({ title: "Gearbox", quantity: 1, unitCostUsd: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.vendor).toBe("amazon");
  });
});

describe("purchase request status transitions", () => {
  it("allows pending to move to approved or rejected", () => {
    expect(canTransitionPurchaseRequest("pending", "approved")).toBe(true);
    expect(canTransitionPurchaseRequest("pending", "rejected")).toBe(true);
  });

  it("blocks skipping straight from pending to received", () => {
    expect(canTransitionPurchaseRequest("pending", "received")).toBe(false);
  });

  it("treats rejected and reimbursed as terminal", () => {
    expect(canTransitionPurchaseRequest("rejected", "approved")).toBe(false);
    expect(canTransitionPurchaseRequest("reimbursed", "pending")).toBe(false);
  });
});

describe("monthly budget summary", () => {
  it("buckets income and expense by month and flags overage", () => {
    const summary = summarizeMonthlyBudget({
      transactions: [
        { type: "expense", amountUsd: 600, occurredAt: "2026-01-05T00:00:00Z" },
        { type: "income", amountUsd: 1000, occurredAt: "2026-01-10T00:00:00Z" },
        { type: "expense", amountUsd: 200, occurredAt: "2026-02-01T00:00:00Z" },
      ],
      monthlyLimitUsd: 500,
      totalLimitUsd: 5000,
    });
    expect(summary.byMonth).toHaveLength(2);
    expect(summary.byMonth[0].overMonthlyLimit).toBe(true);
    expect(summary.byMonth[1].overMonthlyLimit).toBe(false);
    expect(summary.totalIncome).toBe(1000);
    expect(summary.totalExpense).toBe(800);
    expect(summary.remaining).toBe(4200);
  });
});
