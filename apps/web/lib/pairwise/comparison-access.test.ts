import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { deletePairwiseComparison } from "./compute-pairwise";

function client(isOwn: boolean, lead = false) {
  const query = vi.fn(async (sql: string) => sql.includes("has_org_capability")
    ? { rows: [{ allowed: lead }], rowCount: 1 }
    : sql.includes("FOR UPDATE") ? { rows: [{ isOwn }], rowCount: 1 }
    : { rows: [], rowCount: 1 });
  return { db: { query } as unknown as PoolClient, query };
}
const input = { orgId: "org", comparisonId: "comparison" };
describe("pairwise comparison ownership", () => {
  it("lets members undo their own comparison", async () => {
    const { db, query } = client(true);
    await deletePairwiseComparison(db, input);
    expect(query.mock.calls.some(([sql]) => sql.startsWith("DELETE"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes("has_org_capability"))).toBe(false);
  });
  it("requires delegated scouting management to undo another member's comparison", async () => {
    const denied = client(false);
    await expect(deletePairwiseComparison(denied.db, input)).rejects.toMatchObject({ status: 403 });
    expect(denied.query.mock.calls.some(([sql]) => sql.startsWith("DELETE"))).toBe(false);
    const allowed = client(false, true);
    await deletePairwiseComparison(allowed.db, input);
    expect(allowed.query.mock.calls.some(([sql]) => sql.startsWith("DELETE"))).toBe(true);
  });
});
