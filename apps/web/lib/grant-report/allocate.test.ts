import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { GRANT_SPEND_SCHEMA_BLOCKER } from ".";
import {
  INSERT_GRANT_ALLOCATION_SQL,
  allocateGrantFinance,
  listGrantAllocations,
  parseAllocationAmountUsd,
  parseGrantAllocationInput,
} from "./allocate";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const GRANT = "22222222-2222-4222-8222-222222222222";
const TXN = "33333333-3333-4333-8333-333333333333";
const OTHER_GRANT = "44444444-4444-4444-8444-444444444444";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

const VALID_BODY = {
  orgId: ORG,
  grantApplicationId: GRANT,
  financeTransactionId: TXN,
  amountUsd: 150,
};

describe("parseAllocationAmountUsd", () => {
  it("rounds to cents and requires amount > 0", () => {
    expect(parseAllocationAmountUsd(150)).toBe(150);
    expect(parseAllocationAmountUsd(75.555)).toBe(75.56);
    expect(() => parseAllocationAmountUsd(0)).toThrow(/greater than 0/);
    expect(() => parseAllocationAmountUsd(-12)).toThrow(/greater than 0/);
    expect(() => parseAllocationAmountUsd(0.001)).toThrow(/greater than 0/);
    expect(() => parseAllocationAmountUsd(Number.NaN)).toThrow(/finite/);
    expect(() => parseAllocationAmountUsd("DEMO")).toThrow(/finite/);
  });
});

describe("parseGrantAllocationInput", () => {
  it("accepts an explicit grant + transaction + amount", () => {
    const parsed = parseGrantAllocationInput(VALID_BODY);
    expect(parsed).toEqual({ ok: true, value: VALID_BODY });
  });

  it("uses the explicit amount and ignores season totals", () => {
    const parsed = parseGrantAllocationInput({
      ...VALID_BODY,
      seasonTotalUsd: 5000,
      copySeason: true,
      seasonExpensesUsd: 12800,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected parse ok");
    expect(parsed.value.amountUsd).toBe(150);
    expect(parsed.value.amountUsd).toBeLessThan(5000);
  });

  it("refuses a missing amount instead of copying a season total", () => {
    const parsed = parseGrantAllocationInput({
      orgId: ORG,
      grantApplicationId: GRANT,
      financeTransactionId: TXN,
      seasonTotalUsd: 5000,
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected parse fail");
    expect(parsed.error).toMatch(/amountUsd is required/);
  });

  it("rejects amount <= 0 and invalid ids", () => {
    expect(parseGrantAllocationInput({ ...VALID_BODY, amountUsd: 0 }).ok).toBe(false);
    expect(parseGrantAllocationInput({ ...VALID_BODY, amountUsd: -1 }).ok).toBe(false);
    expect(parseGrantAllocationInput({ ...VALID_BODY, orgId: "not-a-uuid" }).ok).toBe(false);
    expect(parseGrantAllocationInput({ ...VALID_BODY, grantApplicationId: "" }).ok).toBe(false);
    expect(parseGrantAllocationInput({ ...VALID_BODY, financeTransactionId: null }).ok).toBe(false);
    expect(parseGrantAllocationInput(null).ok).toBe(false);
  });

  it("never invents DEMO dollars", () => {
    const parsed = parseGrantAllocationInput({
      ...VALID_BODY,
      amountUsd: "DEMO",
    });
    expect(parsed.ok).toBe(false);
    expect(JSON.stringify(VALID_BODY)).not.toMatch(/DEMO/i);
  });
});

describe("allocateGrantFinance", () => {
  function liveHandler(overrides?: {
    schemaOk?: boolean;
    grantFound?: boolean;
    txn?: { type: string; amountUsd: string } | null;
    alreadyAllocated?: string;
    insertRow?: Record<string, unknown> | null;
  }) {
    const queried: string[] = [];
    const paramsLog: unknown[][] = [];
    const client = makeClient((sql, params) => {
      queried.push(sql);
      paramsLog.push(params);
      if (sql.includes("to_regclass")) {
        return { rows: overrides?.schemaOk === false ? [] : [{ ok: "grant_finance_allocations" }] };
      }
      if (sql.includes("FROM grant_applications")) {
        const found = overrides?.grantFound !== false;
        return { rows: found ? [{ ok: 1 }] : [], rowCount: found ? 1 : 0 };
      }
      if (sql.includes("FROM finance_transactions")) {
        const txn = overrides?.txn === undefined ? { type: "expense", amountUsd: "200.00" } : overrides.txn;
        return { rows: txn ? [txn] : [], rowCount: txn ? 1 : 0 };
      }
      if (sql.includes("FROM grant_finance_allocations") && sql.includes("SUM(amount_usd)")) {
        return { rows: [{ allocated: overrides?.alreadyAllocated ?? "0" }] };
      }
      if (sql.includes("INSERT INTO grant_finance_allocations")) {
        const insertRow =
          overrides?.insertRow === undefined
            ? {
                id: "alloc-1",
                orgId: ORG,
                grantApplicationId: GRANT,
                financeTransactionId: TXN,
                amountUsd: "150.00",
                createdBy: USER,
                createdAt: "2026-03-01T00:00:00.000Z",
                updatedAt: "2026-03-01T00:00:00.000Z",
              }
            : overrides.insertRow;
        return { rows: insertRow ? [insertRow] : [], rowCount: insertRow ? 1 : 0 };
      }
      return { rows: [] };
    });
    return { client, queried, paramsLog };
  }

  it("inserts a parameterized allocation for the named expense", async () => {
    const { client, queried, paramsLog } = liveHandler();
    const row = await allocateGrantFinance(client, { ...VALID_BODY, createdBy: USER });

    expect(row.amountUsd).toBe(150);
    expect(row.grantApplicationId).toBe(GRANT);
    expect(row.financeTransactionId).toBe(TXN);
    expect(queried.some((sql) => sql.includes("INSERT INTO grant_finance_allocations"))).toBe(true);
    expect(INSERT_GRANT_ALLOCATION_SQL).toContain("$1::uuid");
    expect(INSERT_GRANT_ALLOCATION_SQL).toContain("$4");
    const insertParams = paramsLog.find((_, i) => queried[i]?.includes("INSERT INTO grant_finance_allocations"));
    expect(insertParams).toEqual([ORG, GRANT, TXN, 150, USER]);
    expect(queried.some((sql) => /SUM\s*\(\s*amount_usd\s*\).*FROM finance_transactions/is.test(sql))).toBe(false);
    expect(queried.some((sql) => sql.includes("season_year") && sql.includes("SUM"))).toBe(false);
  });

  it("refuses income / award rows and missing grant or transaction", async () => {
    await expect(
      allocateGrantFinance(liveHandler({ txn: { type: "income", amountUsd: "2000.00" } }).client, {
        ...VALID_BODY,
        createdBy: USER,
      }),
    ).rejects.toThrow(/expense/);

    await expect(
      allocateGrantFinance(liveHandler({ grantFound: false }).client, { ...VALID_BODY, createdBy: USER }),
    ).rejects.toThrow(/Grant application not found/);

    await expect(
      allocateGrantFinance(liveHandler({ txn: null }).client, { ...VALID_BODY, createdBy: USER }),
    ).rejects.toThrow(/Finance transaction not found/);
  });

  it("refuses an amount larger than the transaction or remaining capacity", async () => {
    await expect(
      allocateGrantFinance(liveHandler({ txn: { type: "expense", amountUsd: "100.00" } }).client, {
        ...VALID_BODY,
        createdBy: USER,
      }),
    ).rejects.toThrow(/cannot exceed the transaction amount/);

    await expect(
      allocateGrantFinance(liveHandler({ alreadyAllocated: "80" }).client, { ...VALID_BODY, createdBy: USER }),
    ).rejects.toThrow(/remaining unallocated/);
  });

  it("blocks writes when the allocations table is missing", async () => {
    const { client, queried } = liveHandler({ schemaOk: false });
    await expect(allocateGrantFinance(client, { ...VALID_BODY, createdBy: USER })).rejects.toThrow(
      GRANT_SPEND_SCHEMA_BLOCKER,
    );
    expect(queried.some((sql) => sql.includes("INSERT INTO"))).toBe(false);
  });

  it("never treats a season total as the allocation amount", async () => {
    const { client, paramsLog, queried } = liveHandler();
    await allocateGrantFinance(client, {
      ...VALID_BODY,
      amountUsd: 40,
      createdBy: USER,
    });
    const insertParams = paramsLog.find((_, i) => queried[i]?.includes("INSERT INTO grant_finance_allocations"));
    expect(insertParams?.[3]).toBe(40);
    expect(insertParams?.[3]).not.toBe(5000);
  });
});

describe("listGrantAllocations", () => {
  it("reads only allocation rows for the named grant", async () => {
    const client = makeClient((sql, params) => {
      if (sql.includes("to_regclass")) return { rows: [{ ok: "grant_finance_allocations" }] };
      if (sql.includes("FROM grant_finance_allocations")) {
        expect(params).toEqual([ORG, GRANT]);
        expect(sql).toContain("grant_application_id = $2::uuid");
        return {
          rows: [
            {
              id: "alloc-1",
              orgId: ORG,
              grantApplicationId: GRANT,
              financeTransactionId: TXN,
              amountUsd: "40.00",
              createdBy: USER,
              createdAt: "2026-03-01T00:00:00.000Z",
              updatedAt: "2026-03-01T00:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const rows = await listGrantAllocations(client, { orgId: ORG, grantApplicationId: GRANT });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amountUsd).toBe(40);
    expect(rows[0]?.grantApplicationId).not.toBe(OTHER_GRANT);
  });
});
