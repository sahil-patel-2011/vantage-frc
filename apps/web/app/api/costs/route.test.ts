/**
 * POST /api/costs (A5-08): a bad amount is a 400 with a sentence, never a $0.00 cost, and a
 * negative budget never erases the budget. The database is a fake that answers by SQL shape.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const state = vi.hoisted(() => ({ queries: [] as Array<{ sql: string; params: unknown[] }> }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => ({ user: { id: "11111111-1111-4111-8111-111111111111" } }) } },
}));
vi.mock("@vantage/db", () => {
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      state.queries.push({ sql, params });
      if (sql.includes("can_manage_finances")) return { rowCount: 1, rows: [{ allowed: true }] };
      if (sql.includes("FROM memberships")) return { rowCount: 1, rows: [{ role: "owner" }] };
      if (sql.includes("INSERT INTO season_costs")) return { rowCount: 1, rows: [{ id: "c1" }] };
      return { rowCount: 0, rows: [] };
    },
  };
  return {
    withRls: async (_context: unknown, work: (c: typeof client) => Promise<unknown>) => work(client),
    withSavepoint: async (_c: unknown, work: () => Promise<unknown>, fallback: unknown) => {
      try {
        return await work();
      } catch {
        return fallback;
      }
    },
  };
});

const { POST } = await import("./route");

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/costs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: ORG, seasonYear: 2026, ...body }),
    }),
  );
}

const writes = () => state.queries.filter((q) => /INSERT INTO|UPDATE \w+ SET|DELETE FROM/i.test(q.sql));

beforeEach(() => {
  state.queries = [];
});

describe("season cost amounts", () => {
  for (const amountUsd of [-50, "abc", "12.345"]) {
    it(`refuses ${JSON.stringify(amountUsd)} instead of saving $0.00`, async () => {
      const response = await post({ action: "add-cost", label: "Bolts", incurredOn: "2026-10-01", status: "paid", amountUsd });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toMatch(/^The amount /);
      expect(writes()).toEqual([]);
    });
  }

  it("reads \"$1,200.50\" as 1200.50", async () => {
    await post({ action: "add-cost", label: "Gearbox", incurredOn: "2026-10-01", amountUsd: "$1,200.50" });
    const insert = state.queries.find((q) => q.sql.includes("INSERT INTO season_costs"));
    expect(insert?.params).toContain(1200.5);
  });
});

describe("the season budget", () => {
  it("refuses a negative budget instead of erasing it", async () => {
    const response = await post({ action: "set-budget", totalBudgetUsd: -5 });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("The season budget can't be negative.");
    expect(writes()).toEqual([]);
  });
});
