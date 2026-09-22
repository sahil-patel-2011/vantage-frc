import { describe, expect, it } from "vitest";
import { GraphClient } from "./graph";
import { type CellValue, type TableSpec, columnLetter } from "./workbook-schema";
import { GraphWorkbookTarget, ensureWorkbookFile, parseRangeAddress, sheetFromAddress, workbookFileName } from "./workbook-target";

/**
 * A small simulation of the Excel REST surface GraphWorkbookTarget uses, so the real
 * request sequence (not a stub of it) is exercised: tables keep at least one body row,
 * dataBodyRange reports the live address, range delete shifts rows up, rows/add appends.
 */
class FakeExcel {
  sheets = new Set<string>(["SyncInfo"]);
  tables = new Map<string, { id: string; sheet: string; columns: string[]; rows: CellValue[][] }>();
  pendingHeader = new Map<string, CellValue[]>();
  requests: string[] = [];
  sessionSupported = true;
  sessionHeaders: Array<string | null> = [];
  private nextId = 1;

  byIdOrName(key: string) {
    for (const [name, table] of this.tables) if (name === key || table.id === key) return [name, table] as const;
    return null;
  }

  fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = decodeURIComponent(url.pathname.replace(/^\/v1\.0/, ""));
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    this.requests.push(`${method} ${path.replace(/^\/me\/drive\/items\/[^/]+\/workbook/, "")}`);
    this.sessionHeaders.push(headers["workbook-session-id"] ?? null);
    const ok = (value: unknown, status = 200) =>
      new Response(value === null ? null : JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    const wb = path.replace(/^\/me\/drive\/items\/[^/]+\/workbook/, "");
    let m: RegExpExecArray | null;

    if (wb === "/createSession") return this.sessionSupported ? ok({ id: "sess-1", persistChanges: true }, 201) : ok({ error: { code: "NotSupported" } }, 501);
    if (wb === "/closeSession") return ok(null, 204);
    if (wb === "/worksheets" && method === "GET") return ok({ value: [...this.sheets].map((name) => ({ name })) });
    if (wb === "/tables" && method === "GET") return ok({ value: [...this.tables.keys()].map((name) => ({ name })) });
    if (wb === "/worksheets/add") {
      this.sheets.add(body.name);
      return ok({ id: `{${body.name}}`, name: body.name }, 201);
    }
    if ((m = /^\/worksheets\/([^/]+)$/.exec(wb)) && method === "DELETE") {
      this.sheets.delete(m[1]!);
      for (const [name, table] of this.tables) if (table.sheet === m[1]) this.tables.delete(name);
      return ok(null, 204);
    }
    if ((m = /^\/worksheets\/([^/]+)\/tables\/add$/.exec(wb))) {
      const header = this.pendingHeader.get(m[1]!) ?? [];
      const id = String(this.nextId++);
      const width = header.length;
      this.tables.set(`Table${id}`, { id, sheet: m[1]!, columns: header.map(String), rows: [Array(width).fill("")] });
      return ok({ id, name: `Table${id}` });
    }
    if ((m = /^\/tables\/([^/]+)$/.exec(wb)) && method === "PATCH") {
      const found = this.byIdOrName(m[1]!)!;
      this.tables.delete(found[0]);
      this.tables.set(body.name, found[1]);
      return ok({ id: found[1].id, name: body.name });
    }
    if ((m = /^\/tables\/([^/]+)\/headerRowRange$/.exec(wb))) {
      const [, table] = this.byIdOrName(m[1]!)!;
      return ok({ values: [table.columns] });
    }
    if ((m = /^\/tables\/([^/]+)\/dataBodyRange$/.exec(wb))) {
      const [, table] = this.byIdOrName(m[1]!)!;
      const last = columnLetter(table.columns.length);
      return ok({ address: `${table.sheet}!A2:${last}${1 + table.rows.length}`, rowCount: table.rows.length });
    }
    if ((m = /^\/tables\/([^/]+)\/rows\/add$/.exec(wb))) {
      const [, table] = this.byIdOrName(m[1]!)!;
      table.rows.push(...(body.values as CellValue[][]));
      return ok({ index: table.rows.length - 1 });
    }
    if ((m = /^\/worksheets\/([^/]+)\/range\(address='([^']+)'\)\/delete$/.exec(wb))) {
      const range = parseRangeAddress(m[2]!)!;
      const table = [...this.tables.values()].find((t) => t.sheet === m![1]);
      if (table) table.rows.splice(range.firstRow - 2, range.lastRow - range.firstRow + 1);
      return ok(null, 204);
    }
    if ((m = /^\/worksheets\/([^/]+)\/range\(address='([^']+)'\)$/.exec(wb)) && method === "GET") {
      const range = parseRangeAddress(m[2]!)!;
      const table = [...this.tables.values()].find((t) => t.sheet === m![1]);
      if (!table) return ok({ error: { code: "itemNotFound" } }, 404);
      return ok({ values: table.rows.slice(range.firstRow - 2, range.lastRow - 1) });
    }
    if ((m = /^\/worksheets\/([^/]+)\/range\(address='([^']+)'\)$/.exec(wb)) && method === "PATCH") {
      const range = parseRangeAddress(m[2]!)!;
      const table = [...this.tables.values()].find((t) => t.sheet === m![1]);
      if (!table) {
        this.pendingHeader.set(m[1]!, body.values[0]);
      } else {
        const values = body.values[0] as CellValue[];
        if (values.some((v) => v === null)) throw new Error("null would leave stale cells");
        table.rows[range.firstRow - 2] = values;
      }
      return ok({ address: m[2] });
    }
    return ok({ error: { code: "itemNotFound", message: `unhandled ${method} ${wb}` } }, 404);
  }) as unknown as typeof fetch;

  view() {
    return JSON.stringify(
      [...this.tables.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, t]) => [name, t.sheet, t.columns, t.rows]),
    );
  }
}

const spec: TableSpec = { entity: "Teams", sheet: "Teams", table: "VantageTeams", columns: ["id", "value", "updated_at", "source"] };

function rows(n: number): CellValue[][] {
  return Array.from({ length: n }, (_, i) => [`frc${i + 1}`, i, "2026-09-22T00:00:00Z", "tba"]);
}

async function sync(excel: FakeExcel, tableSpec: TableSpec, data: CellValue[][]) {
  const graph = new GraphClient("token", { fetchImpl: excel.fetch });
  const target = await GraphWorkbookTarget.open(graph, "item-1");
  await target.ensureTable(tableSpec);
  await target.replaceRows(tableSpec, data);
  await target.close();
  return graph;
}

describe("GraphWorkbookTarget", () => {
  it("creates the sheet and a named table, then writes the rows", async () => {
    const excel = new FakeExcel();
    await sync(excel, spec, rows(3));
    const table = excel.tables.get("VantageTeams")!;
    expect(table.sheet).toBe("Teams");
    expect(table.columns).toEqual(spec.columns);
    expect(table.rows).toEqual(rows(3));
  });

  it("is idempotent: the same data twice gives the same workbook", async () => {
    const excel = new FakeExcel();
    await sync(excel, spec, rows(1200));
    const once = excel.view();
    await sync(excel, spec, rows(1200));
    expect(excel.view()).toBe(once);
    expect(excel.tables.get("VantageTeams")!.rows).toHaveLength(1200);
  });

  it("replaces, never appends: fewer rows shrink the table, zero rows leave one blank row", async () => {
    const excel = new FakeExcel();
    await sync(excel, spec, rows(10));
    await sync(excel, spec, rows(4));
    expect(excel.tables.get("VantageTeams")!.rows).toEqual(rows(4));
    await sync(excel, spec, []);
    expect(excel.tables.get("VantageTeams")!.rows).toEqual([["", "", "", ""]]);
  });

  it("appends in chunks of at most 500 rows, inside one workbook session", async () => {
    const excel = new FakeExcel();
    await sync(excel, spec, rows(1201));
    const adds = excel.requests.filter((r) => r.endsWith("/rows/add"));
    expect(adds).toHaveLength(3); // 1 row by PATCH + 1200 appended in 500/500/200
    expect(excel.requests[0]).toBe("POST /createSession");
    expect(excel.requests.at(-1)).toBe("POST /closeSession");
    expect(excel.sessionHeaders.slice(1, -1).every((h) => h === "sess-1")).toBe(true);
  });

  it("rebuilds the sheet when the columns change", async () => {
    const excel = new FakeExcel();
    await sync(excel, spec, rows(2));
    const wider: TableSpec = { ...spec, columns: [...spec.columns, "data.newField"] };
    await sync(excel, wider, [["frc1", 1, "t", "tba", "x"]]);
    const table = excel.tables.get("VantageTeams")!;
    expect(table.columns).toEqual(wider.columns);
    expect(table.rows).toEqual([["frc1", 1, "t", "tba", "x"]]);
  });

  it("works sessionless when the account cannot create a workbook session (personal accounts)", async () => {
    const excel = new FakeExcel();
    excel.sessionSupported = false;
    await sync(excel, spec, rows(2));
    expect(excel.tables.get("VantageTeams")!.rows).toEqual(rows(2));
    expect(excel.requests).not.toContain("POST /closeSession");
    expect(excel.sessionHeaders.every((h) => h === null)).toBe(true);
  });
});

describe("GraphWorkbookTarget.readTable (import)", () => {
  it("reads back exactly what the sync wrote, in chunks, in a non-persisting session", async () => {
    const excel = new FakeExcel();
    await sync(excel, spec, rows(2500));
    excel.requests.length = 0;
    const createBodies: unknown[] = [];
    const inner = excel.fetch;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/createSession")) createBodies.push(JSON.parse(String(init?.body)));
      return inner(input, init);
    }) as unknown as typeof fetch;
    const graph = new GraphClient("token", { fetchImpl });
    const reader = await GraphWorkbookTarget.open(graph, "item-1", { persistChanges: false });
    const read = await reader.readTable({ entity: "PickList", sheet: "Teams", table: "VantageTeams" });
    await reader.close();
    expect(createBodies).toEqual([{ persistChanges: false }]);
    expect(read!.headers).toEqual(spec.columns);
    expect(read!.rows).toEqual(rows(2500));
    expect(read!.truncated).toBe(false);
    const ranges = excel.requests.filter((r) => r.startsWith("GET /worksheets/Teams/range"));
    expect(ranges).toEqual([
      "GET /worksheets/Teams/range(address='A2:D2001')",
      "GET /worksheets/Teams/range(address='A2002:D2501')",
    ]);
    // Reading never writes.
    expect(excel.requests.some((r) => /^(PATCH|DELETE)|rows\/add|tables\/add|worksheets\/add/.test(r))).toBe(false);
  });

  it("returns null for a table the workbook does not have", async () => {
    const excel = new FakeExcel();
    const reader = await GraphWorkbookTarget.open(new GraphClient("token", { fetchImpl: excel.fetch }), "item-1");
    expect(await reader.readTable({ entity: "PickList", sheet: "PickList", table: "VantagePickList" })).toBeNull();
  });

  it("finds the sheet from the table's own address", () => {
    expect(sheetFromAddress("PickList!A2:S40")).toBe("PickList");
    expect(sheetFromAddress("'Pick ''24'''!A2:B3")).toBe("Pick '24'");
    expect(sheetFromAddress("A2:B3")).toBeNull();
  });
});

describe("OneDrive file helpers", () => {
  it("names the workbook after the team and strips characters OneDrive forbids", () => {
    expect(workbookFileName({ teamNumber: 1234, orgName: "x" })).toBe("Vantage – Team 1234.xlsx");
    expect(workbookFileName({ teamNumber: null, orgName: 'Robo: "Team"?' })).toBe("Vantage – Robo Team.xlsx");
  });

  it("reuses an existing workbook, and creates folder + file when missing", async () => {
    const calls: string[] = [];
    let exists = false;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? "GET"} ${decodeURIComponent(url.pathname)}`);
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
      if (init?.method === "PUT") {
        exists = true;
        expect((init.headers as Record<string, string>)["content-type"]).toContain("spreadsheetml");
        return json({ id: "new-item", name: "Vantage – Team 1.xlsx", webUrl: "https://onedrive/x" }, 201);
      }
      if (init?.method === "POST") return json({ error: { code: "nameAlreadyExists" } }, 409);
      return exists
        ? json({ id: "new-item", name: "Vantage – Team 1.xlsx", webUrl: "https://onedrive/x", file: {} })
        : json({ error: { code: "itemNotFound" } }, 404);
    }) as unknown as typeof fetch;
    const graph = new GraphClient("t", { fetchImpl });
    const created = await ensureWorkbookFile(graph, "Vantage – Team 1.xlsx");
    expect(created).toEqual({ itemId: "new-item", webUrl: "https://onedrive/x", name: "Vantage – Team 1.xlsx" });
    expect(calls).toEqual([
      "GET /v1.0/me/drive/root:/Vantage/Vantage – Team 1.xlsx",
      "POST /v1.0/me/drive/root/children",
      "PUT /v1.0/me/drive/root:/Vantage/Vantage – Team 1.xlsx:/content",
    ]);
    calls.length = 0;
    await ensureWorkbookFile(graph, "Vantage – Team 1.xlsx");
    expect(calls).toHaveLength(1);
  });

  it("parses range addresses", () => {
    expect(parseRangeAddress("Teams!A2:V40")).toEqual({ firstCol: "A", firstRow: 2, lastCol: "V", lastRow: 40 });
    expect(parseRangeAddress("'My Sheet'!$A$2:$B$2")).toEqual({ firstCol: "A", firstRow: 2, lastCol: "B", lastRow: 2 });
    expect(parseRangeAddress("nonsense")).toBeNull();
  });
});
