import { describe, expect, it } from "vitest";
import { contentHash } from "../mirror/mirror-hash";
import { OPS_TABLES, buildAllTables, buildOpsTables } from "./team-ops-tables";
import type { WorkbookSource } from "./workbook-schema";

const NOW = new Date("2026-09-24T12:00:00Z");

function source(ops: WorkbookSource["ops"] = {}): WorkbookSource {
  return {
    orgName: "Ctrl Alt Elite",
    teamNumber: 6925,
    activeEventKey: null,
    teams: [],
    matches: [],
    matchScouting: [],
    pitScouting: [],
    pickList: [],
    ops,
  };
}

describe("team tables", () => {
  it("every table starts with id and ends with updated_at and source, like the rest of the workbook", () => {
    for (const table of OPS_TABLES) {
      expect(table.columns[0], table.entity).toBe("id");
      expect(table.columns.slice(-2), table.entity).toEqual(["updated_at", "source"]);
      expect(new Set(table.columns).size, table.entity).toBe(table.columns.length);
    }
  });

  it("never carries a teammate's email or birthday", () => {
    for (const table of OPS_TABLES) {
      expect(table.columns.join(" "), table.entity).not.toMatch(/email|birth|dob/i);
      expect(table.sql, table.entity).not.toMatch(/\.email|date_of_birth/i);
    }
  });

  it("puts rows in the table's column order and makes a missing table an empty one", () => {
    const [members] = buildOpsTables({
      Members: [{ source: "membership", id: "u1", name: "Sam", role: "scout", role_label: "Student", joined_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" }],
    });
    expect(members?.spec.sheet).toBe("Members");
    expect(members?.rows).toEqual([["u1", "Sam", "scout", "Student", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z", "membership"]]);
    const hours = buildOpsTables({}).find((table) => table.spec.entity === "Hours");
    expect(hours?.rows).toEqual([]);
  });
});

describe("the whole workbook", () => {
  it("orders tabs: event tables, team tables, the Tables catalog, then SyncInfo", () => {
    const sheets = buildAllTables(source(), NOW).map((table) => table.spec.sheet);
    expect(sheets.slice(0, 5)).toEqual(["Teams", "Matches", "MatchScouting", "PitScouting", "PickList"]);
    expect(sheets.slice(5, 5 + OPS_TABLES.length)).toEqual(OPS_TABLES.map((table) => table.entity));
    expect(sheets.slice(-2)).toEqual(["Tables", "SyncInfo"]);
  });

  it("lists every data table in the catalog with its description and row count", () => {
    const tables = buildAllTables(source({ Members: [{ id: "u1", name: "Sam" }] }), NOW);
    const catalog = tables.find((table) => table.spec.entity === "Tables")!;
    const members = catalog.rows.find((row) => row[0] === "Members")!;
    expect(members[1]).toMatch(/Everyone on the team/);
    expect(members[2]).toBe("id");
    expect(members[3]).toBe(1);
    expect(catalog.rows.map((row) => row[0])).not.toContain("SyncInfo");
  });

  it("hashes the same data the same way at any time, and differently when team data changes", () => {
    const a = contentHash(buildAllTables(source({ Members: [{ id: "u1", name: "Sam" }] }), NOW));
    const later = contentHash(buildAllTables(source({ Members: [{ id: "u1", name: "Sam" }] }), new Date("2027-01-01T00:00:00Z")));
    const changed = contentHash(buildAllTables(source({ Members: [{ id: "u1", name: "Sam B." }] }), NOW));
    expect(later).toBe(a);
    expect(changed).not.toBe(a);
  });
});
