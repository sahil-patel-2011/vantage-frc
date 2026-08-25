import { describe, expect, it } from "vitest";
import {
  RECORD_MONEY_INSERT_SQL,
  RECORD_MONEY_UPSERT_SQL,
  dedupeLedgerEntries,
  ledgerEntryKey,
  normalizeAmountUsd,
  normalizeRecordMoney,
  recordMoney,
  recordMoneyParams,
  rollupLedgerByCategory,
  splitLedgerComponents,
  sumLedgerEntries,
  type UnifiedLedgerEntry,
} from "./ledger";

function entry(overrides: Partial<UnifiedLedgerEntry>): UnifiedLedgerEntry {
  return {
    id: "row-1",
    date: "2026-03-01T00:00:00Z",
    label: "Test row",
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

describe("normalizeAmountUsd", () => {
  it("rounds to whole cents", () => {
    expect(normalizeAmountUsd(10.005)).toBe(10.01);
    expect(normalizeAmountUsd(0)).toBe(0);
  });

  it("refuses negative or non-finite amounts — money is never invented", () => {
    expect(() => normalizeAmountUsd(-1)).toThrow();
    expect(() => normalizeAmountUsd(Number.NaN)).toThrow();
    expect(() => normalizeAmountUsd(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("normalizeRecordMoney — direction handling", () => {
  const base = {
    orgId: "org-1",
    source: "season_cost" as const,
    sourceId: "cost-1",
    amountUsd: 25,
    seasonYear: 2026,
  };

  it("maps 'out' to an expense and 'in' to income", () => {
    expect(normalizeRecordMoney({ ...base, direction: "out" }).type).toBe("expense");
    expect(normalizeRecordMoney({ ...base, direction: "in" }).type).toBe("income");
  });

  it("rejects an unknown direction", () => {
    expect(() =>
      normalizeRecordMoney({ ...base, direction: "sideways" as unknown as "in" }),
    ).toThrow(/direction/);
  });

  it("requires a sourceId for every non-manual source (idempotency key)", () => {
    expect(() => normalizeRecordMoney({ ...base, sourceId: null, direction: "out" })).toThrow(
      /idempotent/,
    );
    expect(
      normalizeRecordMoney({ ...base, source: "manual", sourceId: null, direction: "out" }).sourceId,
    ).toBeNull();
  });

  it("keeps the legacy 0035 enum and FK columns in sync for one release", () => {
    const order = normalizeRecordMoney({
      ...base,
      source: "purchase_request",
      sourceId: "pr-9",
      direction: "out",
    });
    expect(order.legacySource).toBe("purchase_request");
    expect(order.purchaseRequestId).toBe("pr-9");
    const cost = normalizeRecordMoney({ ...base, direction: "out" });
    expect(cost.legacySource).toBe("other"); // season_cost is not a 0035 enum value
    expect(cost.purchaseRequestId).toBeNull();
  });
});

describe("recordMoney — idempotent mirror upsert", () => {
  function stubClient() {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    return {
      calls,
      client: {
        query: (sql: string, params: unknown[]) => {
          calls.push({ sql, params });
          return Promise.resolve({ rows: [], rowCount: 0 });
        },
      } as never,
    };
  }

  it("targets the 0461 partial unique index so a repeat write updates, not duplicates", async () => {
    const { calls, client } = stubClient();
    const input = {
      orgId: "org-1",
      source: "purchase_request" as const,
      sourceId: "pr-1",
      direction: "out" as const,
      amountUsd: 149.99,
      seasonYear: 2026,
      label: "Order — swerve modules",
      createdBy: "user-1",
    };
    await recordMoney(client, input);
    await recordMoney(client, input);
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain("ON CONFLICT (org_id, source_kind, source_id) WHERE source_id IS NOT NULL");
    expect(calls[0].sql).toContain("DO UPDATE SET");
    // Same input → byte-identical statement and params: with the DB's unique
    // index this makes the mirror write idempotent.
    expect(calls[1]).toEqual(calls[0]);
  });

  it("uses a plain insert for manual rows — repeated manual entries are distinct", async () => {
    const { calls, client } = stubClient();
    await recordMoney(client, {
      orgId: "org-1",
      source: "manual",
      sourceId: null,
      direction: "in",
      amountUsd: 50,
      seasonYear: 2026,
    });
    expect(calls[0].sql).not.toContain("ON CONFLICT");
    expect(calls[0].sql).toBe(RECORD_MONEY_INSERT_SQL);
  });

  it("binds params in the SQL's column order", () => {
    const row = normalizeRecordMoney({
      orgId: "org-1",
      source: "season_cost",
      sourceId: "cost-1",
      direction: "out",
      amountUsd: 12.34,
      seasonYear: 2026,
      categoryId: null,
      label: "Season cost — pit tape",
    });
    const params = recordMoneyParams(row);
    expect(params).toHaveLength(14);
    expect(params[0]).toBe("org-1");
    expect(params[2]).toBe("expense");
    expect(params[4]).toBe(12.34);
    expect(params[11]).toBe("season_cost");
    expect(params[12]).toBe("cost-1");
    expect(params[13]).toBe(true);
    // The upsert and insert share one VALUES list, so one params builder serves both.
    expect(RECORD_MONEY_UPSERT_SQL).toContain("$14::boolean");
    expect(RECORD_MONEY_INSERT_SQL).toContain("$14::boolean");
  });
});

describe("dedupeLedgerEntries — THE unification dedup rule", () => {
  it("a mirrored + unmirrored mix never double counts the same source row", () => {
    const mirrored = entry({
      id: "txn-1",
      source: "purchase_request",
      sourceId: "pr-1",
      amountUsd: 200,
      mirrored: true,
    });
    const legacy = entry({
      id: "pr-1",
      source: "purchase_request",
      sourceId: "pr-1",
      amountUsd: 200,
      mirrored: false,
    });
    const unmirroredCost = entry({
      id: "cost-1",
      source: "season_cost",
      sourceId: "cost-1",
      amountUsd: 75,
      mirrored: false,
    });

    for (const ordering of [
      [mirrored, legacy, unmirroredCost],
      [legacy, mirrored, unmirroredCost],
    ]) {
      const deduped = dedupeLedgerEntries(ordering);
      expect(deduped).toHaveLength(2);
      // The ledger row is canonical regardless of arrival order.
      expect(deduped.find((e) => e.sourceId === "pr-1")?.mirrored).toBe(true);
      expect(sumLedgerEntries(deduped).outUsd).toBe(275);
    }
  });

  it("never merges keyless manual rows with each other", () => {
    const a = entry({ id: "m1", amountUsd: 10, sourceId: null });
    const b = entry({ id: "m2", amountUsd: 10, sourceId: null });
    expect(dedupeLedgerEntries([a, b])).toHaveLength(2);
    expect(ledgerEntryKey(a)).toBeNull();
  });

  it("keeps distinct source rows from the same table apart", () => {
    const deduped = dedupeLedgerEntries([
      entry({ id: "a", source: "season_cost", sourceId: "cost-1", mirrored: false }),
      entry({ id: "b", source: "season_cost", sourceId: "cost-2", mirrored: false }),
    ]);
    expect(deduped).toHaveLength(2);
  });
});

describe("sumLedgerEntries — direction handling", () => {
  it("separates money in from money out at cent precision", () => {
    const totals = sumLedgerEntries([
      entry({ direction: "in", amountUsd: 0.1 }),
      entry({ direction: "in", amountUsd: 0.2 }),
      entry({ direction: "out", amountUsd: 0.3 }),
    ]);
    expect(totals.inUsd).toBe(0.3);
    expect(totals.outUsd).toBe(0.3);
    expect(totals.balanceUsd).toBe(0);
  });

  it("ignores zero and garbage amounts instead of fabricating money", () => {
    const totals = sumLedgerEntries([
      entry({ amountUsd: 0 }),
      entry({ amountUsd: Number.NaN }),
      entry({ amountUsd: 40, direction: "out" }),
    ]);
    expect(totals.outUsd).toBe(40);
  });
});

describe("splitLedgerComponents", () => {
  it("mirrored rows land in the ledger totals; legacy-only rows report per source", () => {
    const split = splitLedgerComponents([
      entry({ direction: "in", amountUsd: 500, mirrored: true }),
      entry({ direction: "out", amountUsd: 120, mirrored: true, source: "purchase_request", sourceId: "pr-1" }),
      entry({ direction: "out", amountUsd: 80, mirrored: false, source: "purchase_request", sourceId: "pr-2" }),
      entry({ direction: "out", amountUsd: 30, mirrored: false, source: "purchase_log", sourceId: "log-1" }),
      entry({ direction: "out", amountUsd: 45, mirrored: false, source: "season_cost", sourceId: "cost-1" }),
    ]);
    expect(split).toEqual({
      ledgerInUsd: 500,
      ledgerOutUsd: 120,
      purchaseRequestsUsd: 80,
      purchaseLogUsd: 30,
      seasonCostsPaidUsd: 45,
    });
  });

  it("after dedupe, a mirrored order and its legacy duplicate count once, in the ledger", () => {
    const rows = dedupeLedgerEntries([
      entry({ id: "pr-1", direction: "out", amountUsd: 99, mirrored: false, source: "purchase_request", sourceId: "pr-1" }),
      entry({ id: "txn-1", direction: "out", amountUsd: 99, mirrored: true, source: "purchase_request", sourceId: "pr-1" }),
    ]);
    const split = splitLedgerComponents(rows);
    expect(split.ledgerOutUsd).toBe(99);
    expect(split.purchaseRequestsUsd).toBe(0);
  });
});

describe("rollupLedgerByCategory", () => {
  it("groups by category with uncategorized fallback and spend-first ordering", () => {
    const rollup = rollupLedgerByCategory([
      entry({ direction: "out", amountUsd: 100, categoryId: "cat-1", categoryName: "Parts" }),
      entry({ direction: "out", amountUsd: 50, categoryId: "cat-1", categoryName: "Parts" }),
      entry({ direction: "in", amountUsd: 20, categoryId: "cat-1", categoryName: "Parts" }),
      entry({ direction: "out", amountUsd: 60, categoryId: null }),
    ]);
    expect(rollup).toEqual([
      { categoryId: "cat-1", name: "Parts", inUsd: 20, outUsd: 150 },
      { categoryId: null, name: "Uncategorized", inUsd: 0, outUsd: 60 },
    ]);
  });

  it("drops empty buckets and respects the limit", () => {
    const rollup = rollupLedgerByCategory(
      [
        entry({ direction: "out", amountUsd: 5, categoryId: "a", categoryName: "A" }),
        entry({ direction: "out", amountUsd: 9, categoryId: "b", categoryName: "B" }),
        entry({ direction: "out", amountUsd: 0, categoryId: "c", categoryName: "C" }),
      ],
      1,
    );
    expect(rollup).toEqual([{ categoryId: "b", name: "B", inUsd: 0, outUsd: 9 }]);
  });
});
