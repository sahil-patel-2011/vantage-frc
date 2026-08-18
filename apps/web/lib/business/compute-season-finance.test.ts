import { describe, expect, it } from "vitest";
import {
  parseFundingSourceInput,
  parsePurchaseLogInput,
  rollupSeasonFinance,
  usdToCents,
} from "./compute-season-finance";

describe("season finance rollup", () => {
  it("uses funding lines as the income plan when they exist", () => {
    const rollup = rollupSeasonFinance({
      funding: [
        { plannedCents: 10_000_00, receivedCents: 4_000_00 },
        { plannedCents: 2_000_00, receivedCents: 2_000_00 },
      ],
      purchases: [
        { amountCents: 1_500_00, paymentMethod: "card", reimbursedOn: null },
        { amountCents: 200_00, paymentMethod: "reimbursement", reimbursedOn: null },
      ],
      operatingBudgetCents: 8_000_00,
      fundraisingGoalCents: 50_000_00,
      categoryAllocatedCents: 9_000_00,
      sponsorCashCents: 1_000_00,
      sponsorInKindCents: 500_00,
      grantAwardedCents: 3_000_00,
      fundraiserProceedsCents: 250_00,
      fundraiserGoalCents: 1_000_00,
      poRequestedCents: 100_00,
      poCommittedCents: 400_00,
      poSpentCents: 300_00,
      seasonCostsPaidCents: 50_00,
    });

    expect(rollup.plannedIncomeCents).toBe(12_000_00);
    expect(rollup.fundingReceivedCents).toBe(6_000_00);
    expect(rollup.receivedIncomeCents).toBe(6_000_00 + 1_000_00 + 3_000_00 + 250_00);
    expect(rollup.plannedSpendCents).toBe(9_000_00);
    expect(rollup.purchaseLogCents).toBe(1_700_00);
    expect(rollup.actualSpendCents).toBe(1_700_00 + 300_00 + 50_00);
    expect(rollup.committedSpendCents).toBe(1_700_00 + 400_00 + 50_00);
    expect(rollup.reimbursementOpenCents).toBe(200_00);
    expect(rollup.cashPositionCents).toBe(rollup.receivedIncomeCents - rollup.actualSpendCents);
    expect(rollup.remainingToRaiseCents).toBe(Math.max(0, 9_000_00 - rollup.receivedIncomeCents));
  });

  it("falls back to fundraising goals when no funding lines exist", () => {
    const rollup = rollupSeasonFinance({
      funding: [],
      purchases: [],
      operatingBudgetCents: 12_000_00,
      fundraisingGoalCents: 5_000_00,
      categoryAllocatedCents: 0,
      sponsorCashCents: 0,
      sponsorInKindCents: 0,
      grantAwardedCents: 0,
      fundraiserProceedsCents: 0,
      fundraiserGoalCents: 1_500_00,
      poRequestedCents: 0,
      poCommittedCents: 0,
      poSpentCents: 0,
      seasonCostsPaidCents: 0,
    });
    expect(rollup.plannedIncomeCents).toBe(6_500_00);
    expect(rollup.plannedSpendCents).toBe(12_000_00);
    expect(rollup.receivedIncomeCents).toBe(0);
    expect(rollup.remainingToRaiseCents).toBe(12_000_00);
    expect(rollup.actualSpendCents).toBe(0);
  });

  it("does not invent DEMO dollars from empty rows", () => {
    const rollup = rollupSeasonFinance({
      funding: [],
      purchases: [],
      operatingBudgetCents: 0,
      fundraisingGoalCents: 0,
      categoryAllocatedCents: 0,
      sponsorCashCents: 0,
      sponsorInKindCents: 0,
      grantAwardedCents: 0,
      fundraiserProceedsCents: 0,
      fundraiserGoalCents: 0,
      poRequestedCents: 0,
      poCommittedCents: 0,
      poSpentCents: 0,
      seasonCostsPaidCents: 0,
    });
    expect(rollup.plannedIncomeCents).toBe(0);
    expect(rollup.receivedIncomeCents).toBe(0);
    expect(rollup.plannedSpendCents).toBe(0);
    expect(usdToCents(null)).toBe(0);
  });
});

describe("season finance parsers", () => {
  it("parses a school funding line", () => {
    const value = parseFundingSourceInput({
      kind: "school",
      name: "Booster allocation",
      plannedDollars: "12000",
      receivedDollars: "4000.50",
      receivedOn: "2026-08-01",
    });
    expect(value.kind).toBe("school");
    expect(value.plannedUsd).toBe(12000);
    expect(value.receivedUsd).toBe(4000.5);
    expect(value.receivedOn).toBe("2026-08-01");
  });

  it("rejects funding without a name or kind", () => {
    expect(() => parseFundingSourceInput({ kind: "school", name: "  " })).toThrow(/name/i);
    expect(() => parseFundingSourceInput({ kind: "lottery", name: "Nope" })).toThrow(/kind/i);
  });

  it("parses a purchase log receipt", () => {
    const value = parsePurchaseLogInput({
      purchasedOn: "2026-08-12",
      vendor: "McMaster-Carr",
      item: "M3 hardware kit",
      amountDollars: "48.20",
      paymentMethod: "reimbursement",
      receiptUrl: "https://example.com/receipt.pdf",
    });
    expect(value.amountUsd).toBe(48.2);
    expect(value.paymentMethod).toBe("reimbursement");
    expect(value.receiptUrl).toContain("https://");
  });

  it("rejects purchase log rows without a date or vendor", () => {
    expect(() => parsePurchaseLogInput({ vendor: "Amazon", item: "Belt", amountDollars: "10" })).toThrow(/date/i);
    expect(() =>
      parsePurchaseLogInput({ purchasedOn: "2026-08-12", vendor: "", item: "Belt", amountDollars: "10" }),
    ).toThrow(/Vendor/i);
  });
});
