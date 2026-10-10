import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { setPickOrder } from "./store";

const ORG = "22222222-2222-4222-8222-222222222222";
const LIST = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";

type Row = { id: string; rank: number; bucket: string };

function clientWith(rows: Row[], status = "open") {
  const updates: unknown[][] = [];
  const query = vi.fn((sql: string, params: unknown[] = []) => {
    if (/has_org_capability/.test(sql)) return Promise.resolve({ rows: [{ allowed: true }], rowCount: 1 });
    if (/SELECT status FROM pick_lists/.test(sql)) return Promise.resolve({ rows: [{ status }], rowCount: 1 });
    if (/SELECT id, rank, bucket FROM pick_list_entries/.test(sql)) return Promise.resolve({ rows, rowCount: rows.length });
    if (/UPDATE pick_list_entries/.test(sql)) updates.push(params);
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  return { client: { query } as unknown as PoolClient, query, updates };
}

describe("setPickOrder", () => {
  const rows: Row[] = [
    { id: "a", rank: 1, bucket: "first_pick" },
    { id: "b", rank: 2, bucket: "first_pick" },
    { id: "c", rank: 3, bucket: "unranked" },
    { id: "d", rank: 4, bucket: "unranked" },
  ];

  it("writes dense ranks and tiers in bucket order from the visible order", async () => {
    const { client, updates } = clientWith(rows);
    await setPickOrder(client, {
      orgId: ORG,
      userId: USER,
      pickListId: LIST,
      groups: [
        { bucket: "unranked", entryIds: ["d", "c"] },
        { bucket: "first_pick", entryIds: ["b", "a"] },
      ],
    });
    const [, ids, ranks, , buckets] = updates[0]!;
    expect(ids).toEqual(["b", "a", "d", "c"]);
    expect(ranks).toEqual([1, 2, 3, 4]);
    expect(buckets).toEqual(["first_pick", "first_pick", "unranked", "unranked"]);
  });

  it("moves an entry into another tier", async () => {
    const { client, updates } = clientWith(rows);
    await setPickOrder(client, {
      orgId: ORG,
      userId: USER,
      pickListId: LIST,
      groups: [
        { bucket: "first_pick", entryIds: ["a"] },
        { bucket: "second_pick", entryIds: ["b"] },
        { bucket: "unranked", entryIds: ["c", "d"] },
      ],
    });
    const [, ids, , , buckets] = updates[0]!;
    expect(ids).toEqual(["a", "b", "c", "d"]);
    expect(buckets).toEqual(["first_pick", "second_pick", "unranked", "unranked"]);
  });

  it("keeps an entry added a moment ago, after the named ones in its own tier", async () => {
    const { client, updates } = clientWith([...rows, { id: "e", rank: 5, bucket: "first_pick" }]);
    await setPickOrder(client, {
      orgId: ORG,
      userId: USER,
      pickListId: LIST,
      groups: [{ bucket: "first_pick", entryIds: ["b", "a"] }],
    });
    const [, ids] = updates[0]!;
    expect(ids).toEqual(["b", "a", "e", "c", "d"]);
  });

  it("ignores unknown and repeated ids", async () => {
    const { client, updates } = clientWith(rows);
    await setPickOrder(client, {
      orgId: ORG,
      userId: USER,
      pickListId: LIST,
      groups: [{ bucket: "first_pick", entryIds: ["zz", "a", "a", "b"] }],
    });
    const [, ids] = updates[0]!;
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });

  it("refuses a locked list", async () => {
    const { client, updates } = clientWith(rows, "locked");
    await expect(
      setPickOrder(client, { orgId: ORG, userId: USER, pickListId: LIST, groups: [{ bucket: "first_pick", entryIds: ["a"] }] }),
    ).rejects.toThrow(/locked/);
    expect(updates).toHaveLength(0);
  });
});
