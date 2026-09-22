import { describe, expect, it } from "vitest";
import { bulkAddFromBom, defaultSeasonYear, todayIso } from "./compute-manufacturing";

describe("defaultSeasonYear", () => {
  it("uses the calendar year through August", () => {
    expect(defaultSeasonYear(new Date(Date.UTC(2026, 0, 15)))).toBe(2026);
    expect(defaultSeasonYear(new Date(Date.UTC(2026, 7, 31)))).toBe(2026);
  });

  it("rolls to the next game year from September onward", () => {
    expect(defaultSeasonYear(new Date(Date.UTC(2026, 8, 1)))).toBe(2027);
    expect(defaultSeasonYear(new Date(Date.UTC(2026, 11, 31)))).toBe(2027);
  });
});

describe("todayIso", () => {
  it("returns YYYY-MM-DD", () => {
    expect(todayIso(new Date(Date.UTC(2026, 2, 5, 23, 59)))).toBe("2026-03-05");
  });
});

describe("bulkAddFromBom", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  const A = "aaaaaaaa-0000-4000-8000-000000000001";
  const B = "bbbbbbbb-0000-4000-8000-000000000002";
  const GONE = "cccccccc-0000-4000-8000-000000000003";

  it("reads every selected BOM line in one query and seeds cards in the caller's order", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes("FROM bom_entries")) {
          return {
            rows: [
              { id: B, itemId: "item-b", itemName: "Bearing", quantityNeeded: "2.5" },
              { id: A, itemId: "item-a", itemName: "Axle", quantityNeeded: "0" },
            ],
          };
        }
        if (sql.includes("INSERT INTO manufacturing_parts")) return { rows: [{ id: `part-${calls.length}` }] };
        return { rows: [] };
      },
    } as never;

    const created = await bulkAddFromBom(client, {
      orgId: ORG,
      userId: "user",
      bomEntryIds: [A, GONE, B],
      subsystemId: null,
      seasonYear: 2026,
    });

    expect(created).toBe(2);
    const reads = calls.filter((call) => call.sql.includes("FROM bom_entries"));
    expect(reads).toHaveLength(1);
    expect(reads[0]!.params).toEqual([[A, GONE, B], ORG]);
    const parts = calls.filter((call) => call.sql.includes("INSERT INTO manufacturing_parts"));
    // [org, season, partName, quantity, …, bomEntryId at index 7]
    expect(parts.map((call) => [call.params[2], call.params[3], call.params[7]])).toEqual([
      ["Axle", 1, A],
      ["Bearing", 3, B],
    ]);
  });
});
