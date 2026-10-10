import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { deleteEntry, ensurePickList, recordVote, removeVote, saveRankedPickList, setListStatus } from "./store";
const input = { orgId: "org", userId: "member", pickListId: "list", entryId: "entry" };
function client(canManage: boolean, status = "open", drafted = false) {
  const query = vi.fn(async (sql: string) => sql.includes("has_org_capability") ? { rows: [{ allowed: canManage }], rowCount: 1 }
    : sql.includes("SELECT status FROM pick_lists") ? { rows: [{ status }], rowCount: 1 }
    : sql.includes("drafted_alliance_seed IS NOT NULL") ? { rows: drafted ? [{}] : [], rowCount: drafted ? 1 : 0 }
    : { rows: [{}], rowCount: 1 });
  return { query, db: { query } as unknown as PoolClient };
}
describe("shared pick-list authorization", () => {
  it("blocks ordinary-member ranking writes through every caller of the shared store", async () => {
    const { db, query } = client(false);
    await expect(ensurePickList(db, { ...input, eventKey: "2026test" })).rejects.toThrow(/Scouting lead/);
    await expect(setListStatus(db, { ...input, status: "locked" })).rejects.toThrow(/Scouting lead/);
    await expect(deleteEntry(db, input)).rejects.toThrow(/Scouting lead/);
    await expect(saveRankedPickList(db, { ...input, id: "list", eventKey: "2026test", name: "Final", expectedRevision: 4, entries: [] })).rejects.toThrow(/Scouting lead/);
    expect(query.mock.calls.some(([sql]) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
  });
  it("lets ordinary members update and remove their own votes on open lists", async () => {
    const { db, query } = client(false);
    await recordVote(db, { ...input, weight: 2 }); await removeVote(db, input);
    expect(query.mock.calls.some(([sql]) => /INSERT INTO pick_list_entry_votes/.test(sql))).toBe(true);
    expect(query.mock.calls.some(([sql]) => /DELETE FROM pick_list_entry_votes/.test(sql))).toBe(true);
    expect(query.mock.calls.some(([sql]) => /has_org_capability/.test(sql))).toBe(false);
  });
  it("freezes votes on locked or archived lists and protects drafted teams from deletion", async () => {
    for (const status of ["locked", "archived"]) {
      const { db, query } = client(false, status);
      await expect(recordVote(db, { ...input, weight: 1 })).rejects.toThrow(status);
      await expect(removeVote(db, input)).rejects.toThrow(status);
      expect(query.mock.calls.some(([sql]) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
    }
    const { db, query } = client(true, "open", true);
    await expect(deleteEntry(db, input)).rejects.toThrow(/board slot/);
    expect(query.mock.calls.some(([sql]) => /^DELETE/.test(sql))).toBe(false);
  });
});
