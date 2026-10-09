import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { PickListSaveConflict, saveRankedPickList } from "./store";

const input = { orgId: "org", userId: "lead", id: "list", eventKey: "2026test", name: "Final picks", expectedRevision: 4,
  entries: [{ teamKey: "frc6925", rank: 1, tier: "first", notes: "Keep this note" }, { teamKey: "frc254", rank: 2, tier: "watch" }] };

function database(list: { eventKey: string; status: string; revision: number } | null = { eventKey: "2026test", status: "open", revision: 4 }, draftedRemoval = false) {
  const query = vi.fn(async (sql: string, _params: unknown[] = []) => {
    if (sql.includes('event_key AS "eventKey"')) return { rows: list ? [list] : [], rowCount: list ? 1 : 0 };
    if (sql.includes("drafted_alliance_seed IS NOT NULL")) return { rows: draftedRemoval ? [{ teamKey: "frc1678" }] : [], rowCount: draftedRemoval ? 1 : 0 };
    return { rows: [], rowCount: 0 };
  });
  return { query, client: { query } as unknown as PoolClient };
}
const mutations = (query: ReturnType<typeof database>["query"]) => query.mock.calls.filter(([sql]) => /^(INSERT|UPDATE|DELETE)/.test(sql));

describe("ranked snapshot write contract", () => {
  it.each([
    { eventKey: "2026test", status: "open", revision: 5 },
    { eventKey: "2026other", status: "open", revision: 4 },
    { eventKey: "2026test", status: "locked", revision: 4 },
    { eventKey: "2026test", status: "archived", revision: 4 },
    null,
  ])("refuses stale, cross-event, read-only and deleted lists before any write: %j", async list => {
    const { client, query } = database(list);
    await expect(saveRankedPickList(client, input)).rejects.toBeInstanceOf(PickListSaveConflict);
    expect(mutations(query)).toHaveLength(0);
  });
  it("does not delete an omitted team that is still drafted", async () => {
    const { client, query } = database(undefined, true);
    await expect(saveRankedPickList(client, input)).rejects.toThrow(/board slot/);
    expect(mutations(query)).toHaveLength(0);
  });
  it("locks the parent first, deletes only omitted teams and upserts without replacing retained identities or board data", async () => {
    const { client, query } = database();
    await saveRankedPickList(client, input);
    expect(query.mock.calls[1]?.[0]).toContain("FOR UPDATE");
    const deletes = query.mock.calls.filter(([sql]) => sql.startsWith("DELETE"));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.[0]).toContain("org_id=$1::uuid AND pick_list_id=$2::uuid AND NOT(team_key=ANY");
    expect(deletes[0]?.[1]).toEqual(["org", "list", ["frc6925", "frc254"]]);
    const upsert = query.mock.calls.find(([sql]) => sql.includes("ON CONFLICT(pick_list_id,team_key)"))!;
    const updates = upsert[0].split("DO UPDATE SET")[1]!;
    expect(updates).not.toMatch(/\bid\s*=|drafted_|justification|added_by\s*=/);
    expect(upsert[1][4]).toEqual(["frc6925"]); // An omitted note cannot erase another editor's note.
    expect(query.mock.calls.some(([sql]) => /DELETE.*votes/.test(sql))).toBe(false);
  });
  it("creates a first list only from an explicitly empty baseline", async () => {
    const { client, query } = database(null);
    await saveRankedPickList(client, { ...input, expectedRevision: null });
    expect(mutations(query)[0]?.[0]).toContain("INSERT INTO pick_lists");
    expect(mutations(query)[0]?.[1]).toEqual(["list", "org", "2026test", "Final picks", "lead", 2026]);
  });
});
