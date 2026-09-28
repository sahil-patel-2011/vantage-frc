import { describe, expect, it } from "vitest";
import { verifyWorkbookTables, verifyWorkbookLayout } from "./workbooks";
import type { BuiltTable } from "../microsoft/workbook-schema";
import { AppsScriptBridge, type HubTeam } from "../google-sheets/apps-script-bridge";
import { emptyTeamSource } from "../google-sheets/sheets-hub";
import { provisionWorkbooks, workspaceWorkbooks } from "./workbooks";
import { contentHash } from "../mirror/mirror-hash";

describe("Google workbook read-back", () => {
  it("catalogs the actual tables and lossless continuation keys in every workspace", () => {
    const team = { key: "test-team", name: "Test", number: null };
    const source = emptyTeamSource(team);
    source.ops = { Tasks: [{ id: "task-1", notes: "x".repeat(75_000) }] };
    for (const group of workspaceWorkbooks(team, source, new Date("2026-09-26T00:00:00Z"))) {
      const catalog = group.tables.find((table) => table.spec.entity === "Tables")!;
      expect(new Set(catalog.rows.map((row) => row[0]))).toEqual(new Set(group.tables.map((table) => table.spec.sheet)));
      for (const table of group.tables) {
        const row = catalog.rows.find((row) => row[0] === table.spec.sheet)!;
        expect(row[3]).toBe(table.rows.length);
        expect(row[4]).toBe(table.spec.columns.join(", "));
        for (const key of String(row[2]).split(", ")) expect(table.spec.columns).toContain(key);
      }
      expect(catalog.rows.find((row) => row[0] === "LongText")?.[2]).toBe("id, part");
      expect(catalog.rows.find((row) => row[0] === "SyncInfo")?.[2]).toBe("id");
      expect(group.tables.find((table) => table.spec.entity === "SyncInfo")?.rows.find((row) => row[0] === "schema_version")?.[1]).toBe(3);
      if (group.team.title === "Team") expect(group.tables.find((table) => table.spec.entity === "LongText")!.rows.length).toBeGreaterThan(1);
    }
  });
  const tables: BuiltTable[] = [{ spec: { entity: "Tasks", sheet: "Tasks", table: "VantageTasks", columns: ["id", "value"] }, rows: [["1", 0], ["2", false], ["3", "'=SUM(A:A)"], ["4", "00123"]] }];
  it("checks values and types, including zero, false, keys and inert formula-like text", () => {
    expect(() => verifyWorkbookTables(tables, { Tasks: [["id", "value"], ["1", 0], ["2", false], ["3", "=SUM(A:A)"], ["4", "00123"]] })).not.toThrow();
    for (const replacement of ["0", 5, null]) {
      const values = [["id", "value"], ["1", replacement], ["2", false], ["3", "=SUM(A:A)"], ["4", "00123"]];
      expect(() => verifyWorkbookTables(tables, { Tasks: values })).toThrow(/values/);
    }
    expect(() => verifyWorkbookTables(tables, { Tasks: [["id", "value"]] })).toThrow(/verification/);
    expect(() => verifyWorkbookTables(tables, undefined)).toThrow();
  });
  it("requires frozen headers, stable IDs and filters before readiness", () => {
    expect(() => verifyWorkbookLayout(tables, { Tasks: { frozenRows: 1, frozenColumns: 1, filtered: true } })).not.toThrow();
    for (const layout of [{ frozenRows: 0, frozenColumns: 1, filtered: true }, { frozenRows: 1, frozenColumns: 0, filtered: true }, { frozenRows: 1, frozenColumns: 1, filtered: false }]) expect(() => verifyWorkbookLayout(tables, { Tasks: layout })).toThrow(/layout/);
    expect(() => verifyWorkbookLayout(tables)).toThrow(/layout/);
  });
  it("keeps verified resources after a partial write and resumes without duplicates", async () => {
    const bridge = new AppsScriptBridge("https://script.google.com/macros/s/AKfycbx1234567890abcdefghijkLMNOP/exec", "a".repeat(64));
    const books = new Map<string, { id: string; hash: string | null; values: Record<string, unknown[][]> }>();
    const saved = new Map<string, string>();
    let fail = true;
    bridge.call = async <T extends { ok: boolean }>(action: string, payload: Record<string, unknown> = {}) => {
      const team = payload.team as HubTeam;
      const name = team.title!;
      let book = books.get(name);
      const created = !book;
      if (!book) { book = { id: `book-${books.size + 1}`, hash: null, values: {} }; books.set(name, book); }
      if (action === "team.ensure") return { ok: true, id: book.id, created, lastHash: book.hash } as unknown as T;
      if (action === "write") {
        if (name === "Team" && fail) throw new Error("Provider interrupted the write.");
        for (const item of payload.items as Array<{ sheet: string; startRow: number; values: unknown[][]; clear: boolean }>) {
          if (item.clear) book.values[item.sheet] = [];
          item.values.forEach((row, index) => { book!.values[item.sheet]![item.startRow - 1 + index] = row; });
        }
      }
      if (action === "read") return { ok: true, values: book.values } as unknown as T;
      if (action === "team.stamp") book.hash = payload.hash as string;
      if (action === "team.layout") return { ok: true, layout: Object.fromEntries((payload.sheets as string[]).map((sheet) => [sheet, { frozenRows: 1, frozenColumns: book!.values[sheet]?.[0]?.[0] === "id" ? 1 : 0, filtered: true }])) } as unknown as T;
      return { ok: true } as T;
    };
    const team = { key: "test-team", name: "Test", number: null };
    const source = emptyTeamSource(team);
    const onVerified = async (name: string, resource: { id: string }) => { saved.set(name, resource.id); };
    await expect(provisionWorkbooks(bridge, team, source, { onVerified })).rejects.toThrow(/could not be written/);
    expect([...saved.keys()]).toEqual(["Start Here", "Competition"]);
    const retained = [...saved];
    fail = false;
    await provisionWorkbooks(bridge, team, source, { onVerified });
    expect(saved.size).toBe(5); expect(books.size).toBe(5);
    for (const [name, id] of retained) expect(saved.get(name)).toBe(id);
    expect(saved.get("Team")).toBe("book-3");
    // A legacy stamp can have identical data but obsolete catalog metadata.
    const group = workspaceWorkbooks(team, source, new Date()).find((item) => item.team.title === "Team")!;
    const existing = books.get("Team")!;
    existing.hash = contentHash(group.tables);
    existing.values.SyncInfo!.find((row) => row[0] === "schema_version")![1] = 1;
    await provisionWorkbooks(bridge, team, source, { only: "Team", onVerified });
    expect(existing.values.SyncInfo!.find((row) => row[0] === "schema_version")![1]).toBe(3);
    expect(books.size).toBe(5);
    expect(saved.get("Team")).toBe("book-3");
  });
});
