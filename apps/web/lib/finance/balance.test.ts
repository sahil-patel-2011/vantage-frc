import { describe, expect, it } from "vitest";
import {
  UNIFIED_LEDGER_SQL,
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
  it("sums only ledger in and ledger out", () => {
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
    expect(totals.totalInUsd).toBe(100);
    expect(totals.totalOutUsd).toBe(75.25);
    expect(totals.balanceUsd).toBe(24.75);
  });

  it("ignores leftover fallback component fields — they are not cash", () => {
    const totals = sumBalanceComponents({
      ...zeroComponents,
      ledgerInUsd: 10,
      ledgerOutUsd: 4,
      sponsorCashUsd: 999,
      fundraiserProceedsUsd: 999,
      fundingReceivedUsd: 999,
      grantAwardedUsd: 999,
      purchaseRequestsUsd: 999,
      purchaseLogUsd: 999,
      seasonCostsPaidUsd: 999,
    });
    expect(totals.totalInUsd).toBe(10);
    expect(totals.totalOutUsd).toBe(4);
    expect(totals.balanceUsd).toBe(6);
  });

  it("keeps cent precision without float drift", () => {
    const totals = sumBalanceComponents({
      ...zeroComponents,
      ledgerInUsd: 0.1,
      sponsorCashUsd: 0.2,
      ledgerOutUsd: 0.3,
    });
    expect(totals.totalInUsd).toBe(0.1);
    expect(totals.totalOutUsd).toBe(0.3);
    expect(totals.balanceUsd).toBe(-0.2);
  });

  it("allows a negative balance when spend exceeds income", () => {
    const totals = sumBalanceComponents({ ...zeroComponents, ledgerInUsd: 100, ledgerOutUsd: 350 });
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
    expect(view.ledger).toEqual([]);
    expect(view.computedAt).toBe("2026-08-23T00:00:00.000Z");
  });

  it("does not treat leftover fallback components or activity as data", () => {
    const view = assembleFinanceBalance({
      orgId: "org-1",
      components: { ...zeroComponents, sponsorCashUsd: 1200, purchaseLogUsd: 199.99 },
      byCategory: [],
      recentActivity: [
        { date: "2026-03-05T00:00:00Z", label: "Sponsor cash — Acme", amountUsd: 1200, direction: "in" },
      ],
      ledger: [
        {
          id: "legacy-1",
          date: "2026-03-05T00:00:00Z",
          label: "Sponsor cash — Acme",
          amountUsd: 1200,
          direction: "in",
          source: "sponsor_contribution",
          sourceId: "sc-1",
          categoryId: null,
          categoryName: null,
          mirrored: false,
        },
      ],
    });
    expect(view.hasData).toBe(false);
    expect(view.totalInUsd).toBe(0);
    expect(view.totalOutUsd).toBe(0);
    expect(view.balanceUsd).toBe(0);
    expect(view.ledger).toEqual([]);
  });

  it("derives the balance from ledger components — no stored balance is trusted", () => {
    const view = assembleFinanceBalance({
      orgId: "org-1",
      components: { ...zeroComponents, ledgerInUsd: 1200, ledgerOutUsd: 199.99 },
      byCategory: [{ categoryId: null, name: "Uncategorized", inUsd: 0, outUsd: 199.99 }],
      recentActivity: [
        { date: "2026-03-02T00:00:00Z", label: "Hardware", amountUsd: 199.99, direction: "out" },
        { date: "2026-03-05T00:00:00Z", label: "Sponsor cash — Acme", amountUsd: 1200, direction: "in" },
      ],
      ledger: [
        {
          id: "in-1",
          date: "2026-03-05T00:00:00Z",
          label: "Sponsor cash — Acme",
          amountUsd: 1200,
          direction: "in",
          source: "sponsor_contribution",
          sourceId: "sc-1",
          categoryId: null,
          categoryName: null,
          mirrored: true,
        },
        {
          id: "out-1",
          date: "2026-03-02T00:00:00Z",
          label: "Hardware",
          amountUsd: 199.99,
          direction: "out",
          source: "purchase_log",
          sourceId: "log-1",
          categoryId: null,
          categoryName: null,
          mirrored: true,
        },
      ],
    });
    expect(view.hasData).toBe(true);
    expect(view.totalInUsd).toBe(1200);
    expect(view.totalOutUsd).toBe(199.99);
    expect(view.balanceUsd).toBe(1000.01);
    expect(view.recentActivity[0].label).toBe("Sponsor cash — Acme");
    expect(view.byCategory).toHaveLength(1);
    expect(view.ledger).toHaveLength(2);
  });
});

describe("UNIFIED_LEDGER_SQL", () => {
  it("reads only finance_transactions — no legacy fallback unions", () => {
    expect(UNIFIED_LEDGER_SQL).toContain("$1::uuid");
    expect(UNIFIED_LEDGER_SQL).toContain("FROM finance_transactions");
    expect(UNIFIED_LEDGER_SQL).toContain("t.counts_in_balance");
    expect(UNIFIED_LEDGER_SQL).not.toContain("fallback AS");
    expect(UNIFIED_LEDGER_SQL).not.toContain("UNION ALL");
    expect(UNIFIED_LEDGER_SQL).not.toContain("SELECT * FROM fallback");
  });
});
