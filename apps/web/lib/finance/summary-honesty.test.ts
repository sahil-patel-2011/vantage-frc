import { describe, expect, it } from "vitest";
import {
  assembleHonestFinanceSummary,
  isEmptyFinanceBooks,
  ledgerTransactionsForSummary,
} from "./summary-honesty";

describe("ledgerTransactionsForSummary", () => {
  it("keeps finite income/expense rows and drops garbage", () => {
    const kept = ledgerTransactionsForSummary([
      { type: "income", amountUsd: "400.50", occurredAt: "2026-01-15T00:00:00Z" },
      { type: "expense", amountUsd: 50, occurredAt: "2026-02-01T00:00:00Z" },
      { type: "income", amountUsd: "not-money", occurredAt: "2026-01-16T00:00:00Z" },
      { type: "transfer", amountUsd: 10, occurredAt: "2026-01-17T00:00:00Z" },
      { type: "income", amountUsd: 25, occurredAt: "" },
      { type: "expense", amountUsd: Number.NaN, occurredAt: "2026-01-18T00:00:00Z" },
    ]);
    expect(kept).toEqual([
      { type: "income", amountUsd: 400.5, occurredAt: "2026-01-15T00:00:00Z" },
      { type: "expense", amountUsd: 50, occurredAt: "2026-02-01T00:00:00Z" },
    ]);
  });
});

describe("isEmptyFinanceBooks", () => {
  it("treats no rows and $0-only rows as empty books", () => {
    expect(isEmptyFinanceBooks([])).toBe(true);
    expect(isEmptyFinanceBooks([{ type: "income", amountUsd: 0, occurredAt: "2026-01-01" }])).toBe(true);
    expect(isEmptyFinanceBooks([{ type: "expense", amountUsd: 0.004, occurredAt: "2026-01-01" }])).toBe(true);
  });

  it("is not empty once a real cent moved on the ledger", () => {
    expect(isEmptyFinanceBooks([{ type: "income", amountUsd: 0.01, occurredAt: "2026-01-01" }])).toBe(false);
  });
});

describe("assembleHonestFinanceSummary", () => {
  it("empty books close at $0 with empty=true — never a DEMO fill", () => {
    const summary = assembleHonestFinanceSummary({
      transactions: [],
      sponsorCashUsd: 12_000,
      totalLimitUsd: 5_000,
    });
    expect(summary.empty).toBe(true);
    expect(summary.totalIncome).toBe(0);
    expect(summary.totalExpense).toBe(0);
    expect(summary.net).toBe(0);
    expect(summary.byMonth).toEqual([]);
    expect(summary.sponsorCashUsd).toBe(0);
    expect(summary.remaining).toBe(5000);
    expect(summary.overTotalLimit).toBe(false);
    expect(JSON.stringify(summary)).not.toMatch(/DEMO/i);
  });

  it("does not add a separate sponsor_contributions sum on top of ledger income", () => {
    const summary = assembleHonestFinanceSummary({
      transactions: [
        { type: "income", amountUsd: 400, occurredAt: "2026-01-15T00:00:00Z" },
        { type: "expense", amountUsd: 50, occurredAt: "2026-02-01T00:00:00Z" },
      ],
      sponsorCashUsd: 400,
    });
    expect(summary.empty).toBe(false);
    expect(summary.totalIncome).toBe(400);
    expect(summary.totalExpense).toBe(50);
    expect(summary.net).toBe(350);
    expect(summary.sponsorCashUsd).toBe(0);
    expect(summary.totalIncome + summary.sponsorCashUsd).toBe(400);
  });

  it("counts sponsor-sourced ledger rows once — they are already season cash", () => {
    const summary = assembleHonestFinanceSummary({
      transactions: [
        { type: "income", amountUsd: 1200, occurredAt: "2026-03-05T00:00:00Z" },
        { type: "income", amountUsd: 300, occurredAt: "2026-03-12T00:00:00Z" },
        { type: "expense", amountUsd: 199.99, occurredAt: "2026-03-20T00:00:00Z" },
      ],
      sponsorCashUsd: 1500,
    });
    expect(summary.totalIncome).toBe(1500);
    expect(summary.totalExpense).toBe(199.99);
    expect(summary.net).toBe(1300.01);
    expect(summary.sponsorCashUsd).toBe(0);
    expect(summary.byMonth).toHaveLength(1);
    expect(summary.byMonth[0]).toMatchObject({ month: "2026-03", income: 1500, expense: 199.99, net: 1300.01 });
  });

  it("treats $0-only ledger rows as empty books, not DEMO progress", () => {
    const summary = assembleHonestFinanceSummary({
      transactions: [
        { type: "income", amountUsd: 0, occurredAt: "2026-01-01T00:00:00Z" },
        { type: "expense", amountUsd: "0.00", occurredAt: "2026-01-02T00:00:00Z" },
      ],
      sponsorCashUsd: 999,
    });
    expect(summary.empty).toBe(true);
    expect(summary.totalIncome).toBe(0);
    expect(summary.totalExpense).toBe(0);
    expect(summary.net).toBe(0);
    expect(summary.byMonth).toEqual([]);
    expect(summary.sponsorCashUsd).toBe(0);
    expect(JSON.stringify(summary)).not.toMatch(/DEMO/i);
  });
});
