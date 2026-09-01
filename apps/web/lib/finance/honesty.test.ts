import { describe, expect, it } from "vitest";
import {
  hasRealLedgerData,
  isHonestTieOut,
  isRealCashAmount,
  isRealLedgerEntry,
  keepRealLedgerEntries,
} from "./honesty";
import type { UnifiedLedgerEntry } from "./ledger";

function entry(overrides: Partial<UnifiedLedgerEntry>): UnifiedLedgerEntry {
  return {
    id: "row-1",
    date: "2026-03-01T00:00:00Z",
    label: "Entry",
    amountUsd: 100,
    direction: "out",
    source: "manual",
    sourceId: null,
    categoryId: null,
    categoryName: null,
    mirrored: true,
    ...overrides,
  };
}

describe("isRealCashAmount", () => {
  it("accepts finite dollars that round to at least one cent", () => {
    expect(isRealCashAmount(0.01)).toBe(true);
    expect(isRealCashAmount("12.50")).toBe(true);
    expect(isRealCashAmount(10.005)).toBe(true);
  });

  it("rejects $0, null, and garbage — never invents progress", () => {
    expect(isRealCashAmount(0)).toBe(false);
    expect(isRealCashAmount(0.004)).toBe(false);
    expect(isRealCashAmount(null)).toBe(false);
    expect(isRealCashAmount(undefined)).toBe(false);
    expect(isRealCashAmount("")).toBe(false);
    expect(isRealCashAmount("not-a-number")).toBe(false);
    expect(isRealCashAmount(Number.NaN)).toBe(false);
    expect(isRealCashAmount(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("keepRealLedgerEntries", () => {
  it("keeps only mirrored rows with real cash", () => {
    const kept = keepRealLedgerEntries([
      entry({ id: "ok", amountUsd: 25 }),
      entry({ id: "fallback", amountUsd: 400, mirrored: false, source: "purchase_request" }),
      entry({ id: "zero", amountUsd: 0 }),
      entry({ id: "nan", amountUsd: Number.NaN }),
    ]);
    expect(kept.map((row) => row.id)).toEqual(["ok"]);
  });

  it("treats an empty or fallback-only list as no data, not a $0 success", () => {
    expect(hasRealLedgerData([])).toBe(false);
    expect(hasRealLedgerData([entry({ mirrored: false, amountUsd: 50 })])).toBe(false);
    expect(hasRealLedgerData([entry({ amountUsd: 0 })])).toBe(false);
    expect(isRealLedgerEntry(entry({ amountUsd: 1 }))).toBe(true);
  });
});

describe("isHonestTieOut", () => {
  it("refuses a $0 close with no rows — empty books are not a reconciled season", () => {
    expect(isHonestTieOut({ closingUsd: 0, reportedBalanceUsd: 0, rowCount: 0 })).toBe(false);
  });

  it("agrees only when real rows land on the same cent as the balance view", () => {
    expect(isHonestTieOut({ closingUsd: 329.75, reportedBalanceUsd: 329.75, rowCount: 3 })).toBe(true);
    expect(isHonestTieOut({ closingUsd: 329.75, reportedBalanceUsd: 330, rowCount: 3 })).toBe(false);
    expect(isHonestTieOut({ closingUsd: Number.NaN, reportedBalanceUsd: 0, rowCount: 1 })).toBe(false);
  });
});
