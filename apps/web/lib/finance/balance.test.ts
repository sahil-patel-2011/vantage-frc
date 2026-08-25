import { describe, expect, it } from "vitest";
import {
  assembleFinanceBalance,
  normalizeActivity,
  sumBalanceComponents,
  toUsd,
  type BalanceActivityRow,
  type FinanceBalanceComponents,
} from "./balance";

const zeroComponents: FinanceBalanceComponents = {
  ledgerInUsd: 0,
  sponsorCashUsd: 0,
  fundraiserProceedsUsd: 0,
  fundingReceivedUsd: 0,
  grantAwardedUsd: 0,
  ledgerOutUsd: 0,
  purchaseRequestsUsd: 0,
  purchaseLogUsd: 0,
  seasonCostsPaidUsd: 0,
};

describe("toUsd", () => {
  it("parses numeric text from Postgres to cent precision", () => {
    expect(toUsd("1234.56")).toBe(1234.56);
    expect(toUsd("0")).toBe(0);
    expect(toUsd(10.005)).toBe(10.01);
  });

  it("treats null, undefined, and garbage as zero — never invents money", () => {
    expect(toUsd(null)).toBe(0);
    expect(toUsd(undefined)).toBe(0);
    expect(toUsd("not-a-number")).toBe(0);
    expect(toUsd(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("sumBalanceComponents", () => {
  it("sums every in-component and every out-component", () => {
    const totals = sumBalanceComponents({
      ledgerInUsd: 100,
      sponsorCashUsd: 250.5,
      fundraiserProceedsUsd: 49.5,
      fundingReceivedUsd: 1000,
      grantAwardedUsd: 500,
      ledgerOutUsd: 75.25,
      purchaseRequestsUsd: 300,
      purchaseLogUsd: 24.75,
      seasonCostsPaidUsd: 400,
    });
    expect(totals.totalInUsd).toBe(1900);
    expect(totals.totalOutUsd).toBe(800);
    expect(totals.balanceUsd).toBe(1100);
  });

  it("keeps cent precision without float drift", () => {
    const totals = sumBalanceComponents({
      ...zeroComponents,
      ledgerInUsd: 0.1,
      sponsorCashUsd: 0.2,
      ledgerOutUsd: 0.3,
    });
    expect(totals.totalInUsd).toBe(0.3);
    expect(totals.totalOutUsd).toBe(0.3);
    expect(totals.balanceUsd).toBe(0);
  });

  it("allows a negative balance when spend exceeds income", () => {
    const totals = sumBalanceComponents({ ...zeroComponents, ledgerInUsd: 100, purchaseRequestsUsd: 350 });
    expect(totals.balanceUsd).toBe(-250);
  });
});

describe("normalizeActivity", () => {
  const row = (date: string, amountUsd = 10, direction: "in" | "out" = "in"): BalanceActivityRow => ({
    date,
    label: `row ${date}`,
    amountUsd,
    direction,
  });

  it("sorts newest first and caps at ten", () => {
    const rows = Array.from({ length: 14 }, (_, i) =>
      row(`2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
    );
    const result = normalizeActivity(rows);
    expect(result).toHaveLength(10);
    expect(result[0].date).toBe("2026-01-14T00:00:00Z");
    expect(result[9].date).toBe("2026-01-05T00:00:00Z");
  });

  it("drops zero-amount rows instead of showing fabricated activity", () => {
    const result = normalizeActivity([row("2026-02-01", 0), row("2026-02-02", 25, "out")]);
    expect(result).toHaveLength(1);
    expect(result[0].direction).toBe("out");
  });
});

describe("assembleFinanceBalance", () => {
  it("reports an honest empty state when there are no rows anywhere", () => {
    const view = assembleFinanceBalance({
      orgId: "org-1",
      components: zeroComponents,
      byCategory: [],
      recentActivity: [],
      now: new Date("2026-08-23T00:00:00Z"),
    });
    expect(view.status).toBe("live");
    expect(view.hasData).toBe(false);
    expect(view.totalInUsd).toBe(0);
    expect(view.totalOutUsd).toBe(0);
    expect(view.balanceUsd).toBe(0);
    expect(view.recentActivity).toEqual([]);
    expect(view.computedAt).toBe("2026-08-23T00:00:00.000Z");
  });

  it("derives the balance from components — no stored balance is trusted", () => {
    const view = assembleFinanceBalance({
      orgId: "org-1",
      components: { ...zeroComponents, sponsorCashUsd: 1200, purchaseLogUsd: 199.99 },
      byCategory: [{ categoryId: null, name: "Uncategorized", inUsd: 0, outUsd: 199.99 }],
      recentActivity: [
        { date: "2026-03-02T00:00:00Z", label: "Hardware", amountUsd: 199.99, direction: "out" },
        { date: "2026-03-05T00:00:00Z", label: "Sponsor cash — Acme", amountUsd: 1200, direction: "in" },
      ],
    });
    expect(view.hasData).toBe(true);
    expect(view.totalInUsd).toBe(1200);
    expect(view.totalOutUsd).toBe(199.99);
    expect(view.balanceUsd).toBe(1000.01);
    expect(view.recentActivity[0].label).toBe("Sponsor cash — Acme");
    expect(view.byCategory).toHaveLength(1);
  });
});
