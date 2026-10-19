import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { computeSeasonFinanceView } from "./compute-season-finance";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function stubClient() {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM memberships m")) return { rows: [{ orgId: ORG, orgName: "Team", teamNumber: 1, role: "owner" }], rowCount: 1 };
    if (sql.includes("can_manage_finances")) return { rows: [{ allowed: true }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return { client: { query } as unknown as PoolClient, query };
}

const spendSql = (query: ReturnType<typeof stubClient>["query"]) =>
  String(query.mock.calls.find(([sql]) => String(sql).includes('AS "spentUsd"'))?.[0] ?? "");

describe("season finance spend", () => {
  it("counts bought requests at what they actually cost once 0738 is applied", async () => {
    const { client, query } = stubClient();
    await computeSeasonFinanceView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026, countActualSpend: true });
    expect(spendSql(query)).toContain("SUM(COALESCE(actual_cost_usd, total_cost_usd)) FILTER (WHERE status IN ('ordered','received','reimbursed'))");
  });

  it("keeps the approved figure before then, never naming a column that isn't there", async () => {
    const { client, query } = stubClient();
    await computeSeasonFinanceView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });
    expect(spendSql(query)).toContain("SUM(total_cost_usd) FILTER (WHERE status IN ('ordered','received','reimbursed'))");
    expect(spendSql(query)).not.toContain("actual_cost_usd");
  });
});
