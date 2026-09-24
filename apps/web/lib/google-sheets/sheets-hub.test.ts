import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AppsScriptBridge, AppsScriptTarget } from "./apps-script-bridge";
import { APPS_SCRIPT_VERSION, appsScriptSource, newAppsScriptSecret } from "./apps-script-source";
import { ensureHubSheetForNewTeam, sheetsHubConfig, teamSheetTitle } from "./sheets-hub";

const URL_OK = "https://script.google.com/macros/s/AKfycbxHUB1234567890abcdefghijk/exec";

/**
 * The script deployed on its own (hub mode): no active spreadsheet, a Drive with folders and
 * files, and SpreadsheetApp.create/openById. Just enough of Google to run the real script.
 */
function loadHub(secret: string) {
  type Sheet = { name: string; cells: unknown[][] };
  type Book = { id: string; name: string; sheets: Sheet[]; parent: string | null; trashed: boolean; viewers: string[] };
  let seq = 0;
  const books = new Map<string, Book>();
  const folders = new Map<string, { id: string; name: string; trashed: boolean }>();
  const props = new Map<string, string>();
  const iter = <T,>(items: T[]) => {
    let i = 0;
    return { hasNext: () => i < items.length, next: () => items[i++]! };
  };
  // Anything the fake does not model (styling, filters, banding, protection) is a chainable
  // no-op: the script's layout pass runs for real, and only its data effects are checked.
  const lenient = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(obj, key) {
        if (key in obj) return (obj as Record<PropertyKey, unknown>)[key];
        if (key === "then") return undefined;
        const noop = (): unknown => lenient({});
        return noop;
      },
    });
  const range = (sheet: Sheet, row: number, col = 1, rows = 1, cols?: number) =>
    lenient({
      setValues(values: unknown[][]) {
        values.forEach((r, i) => {
          const at = row - 1 + i;
          const next = [...(sheet.cells[at] ?? [])];
          r.forEach((cell, j) => {
            next[col - 1 + j] = cell;
          });
          sheet.cells[at] = next;
        });
      },
      getValues: () =>
        Array.from({ length: rows }, (_, i) => {
          const r = sheet.cells[row - 1 + i] ?? [];
          return r.slice(col - 1, cols ? col - 1 + cols : undefined);
        }),
      getDisplayValue: () => String(sheet.cells[row - 1]?.[col - 1] ?? ""),
      rows,
    });
  const sheetApi = (sheet: Sheet) =>
    lenient({
      clearContents() {
        sheet.cells = [];
      },
      getName: () => sheet.name,
      getMaxRows: () => 5000,
      getMaxColumns: () => 50,
      getLastRow: () => sheet.cells.length,
      getLastColumn: () => sheet.cells.reduce((max, r) => Math.max(max, r.length), 0),
      getColumnWidth: () => 100,
      getBandings: () => [],
      getFilter: () => null,
      getProtections: () => [],
      getRange: (row: number, col?: number, rows?: number, cols?: number) => range(sheet, row, col ?? 1, rows ?? 1, cols),
      getDataRange: () => ({ getValues: () => sheet.cells.map((r) => [...r]) }),
    });
  const bookApi = (book: Book): Record<string, unknown> => ({
    getId: () => book.id,
    getName: () => book.name,
    getUrl: () => `https://docs.google.com/spreadsheets/d/${book.id}/edit`,
    rename: (name: string) => {
      book.name = name;
    },
    getSheets: () => book.sheets.map(sheetApi),
    getSheetByName: (name: string) => {
      const sheet = book.sheets.find((s) => s.name === name);
      return sheet ? sheetApi(sheet) : null;
    },
    insertSheet: (name: string, index?: number) => {
      const sheet = { name, cells: [] };
      if (index === 0) book.sheets.unshift(sheet);
      else book.sheets.push(sheet);
      return sheetApi(sheet);
    },
    deleteSheet: (api: { getName: () => string }) => {
      book.sheets = book.sheets.filter((s) => s.name !== api.getName());
    },
    setActiveSheet: (api: { getName: () => string }) => {
      active = api.getName();
    },
    moveActiveSheet: (position: number) => {
      const index = book.sheets.findIndex((s) => s.name === active);
      if (index < 0) return;
      const [moved] = book.sheets.splice(index, 1);
      book.sheets.splice(position - 1, 0, moved!);
    },
    setNamedRange: () => {},
  });
  let active = "";
  const globals = {
    SpreadsheetApp: {
      BandingTheme: { LIGHT_GREY: "LIGHT_GREY" },
      WrapStrategy: { CLIP: "CLIP" },
      ProtectionType: { SHEET: "SHEET" },
      getActiveSpreadsheet: () => null,
      create: (name: string) => {
        const book: Book = { id: `book${++seq}`, name, sheets: [{ name: "Sheet1", cells: [] }], parent: null, trashed: false, viewers: [] };
        books.set(book.id, book);
        return bookApi(book);
      },
      openById: (id: string) => {
        const book = books.get(id);
        if (!book) throw new Error("not found");
        return bookApi(book);
      },
    },
    DriveApp: {
      getFolderById: (id: string) => {
        const folder = folders.get(id);
        if (!folder) throw new Error("not found");
        return { getId: () => folder.id, getName: () => folder.name, getUrl: () => `https://drive.google.com/drive/folders/${folder.id}`, isTrashed: () => folder.trashed };
      },
      getFoldersByName: (name: string) =>
        iter([...folders.values()].filter((f) => f.name === name).map((f) => globals.DriveApp.getFolderById(f.id))),
      createFolder: (name: string) => {
        const folder = { id: `folder${++seq}`, name, trashed: false };
        folders.set(folder.id, folder);
        return globals.DriveApp.getFolderById(folder.id);
      },
      getFileById: (id: string) => {
        const book = books.get(id);
        if (!book) throw new Error("not found");
        return {
          isTrashed: () => book.trashed,
          moveTo: (folder: { getId: () => string }) => {
            book.parent = folder.getId();
          },
          addViewer: (email: string) => {
            book.viewers.push(email);
          },
          removeViewer: (email: string) => {
            book.viewers = book.viewers.filter((viewer) => viewer !== email);
          },
        };
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key: string) => props.get(key) ?? null,
        setProperty: (key: string, value: string) => props.set(key, value),
        deleteProperty: (key: string) => props.delete(key),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      computeHmacSha256Signature: (value: string, key: string) =>
        [...createHmac("sha256", key).update(value).digest()].map((b) => (b > 127 ? b - 256 : b)),
      formatDate: (date: Date) => date.toISOString(),
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (text: string) => ({ text, setMimeType() { return this; } }),
    },
  };
  const factory = new Function(...Object.keys(globals), `${appsScriptSource(secret)}\nreturn { doPost };`) as (
    ...args: unknown[]
  ) => { doPost: (e: unknown) => { text: string } };
  const script = factory(...Object.values(globals));
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      const sig = new URL(url).searchParams.get("sig") ?? "";
      const out = script.doPost({ postData: { contents: String(init.body) }, parameter: { sig } });
      return new Response(null, { status: 302, headers: { location: `https://script.googleusercontent.com/macros/echo?k=${encodeURIComponent(out.text)}` } });
    }
    return new Response(new URL(url).searchParams.get("k") ?? "", { status: 200 });
  }) as typeof fetch;
  return { books, folders, fetchImpl };
}

const TEAM = { key: "6925a000-0000-4000-8000-000000000001", number: 6925, name: "Ctrl  Alt Elite", viewers: ["Owner@Example.test"] };

describe("team sheets in the VantageFRC folder", () => {
  it("makes one spreadsheet per team, named the standard way, in the VantageFRC folder", async () => {
    const secret = newAppsScriptSecret();
    const hub = loadHub(secret);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: hub.fetchImpl });

    await expect(bridge.ping({ hub: true })).resolves.toMatchObject({ version: APPS_SCRIPT_VERSION, hub: true, name: "VantageFRC" });

    const first = await bridge.ensureTeamBook(TEAM);
    expect(first).toMatchObject({ created: true, name: "6925 - Ctrl Alt Elite - VantageFRC", lastHash: null });
    expect(first.url).toMatch(/^https:\/\/docs\.google\.com\/spreadsheets\//);

    const book = hub.books.get(first.id)!;
    const folder = [...hub.folders.values()].find((f) => f.id === book.parent);
    expect(folder?.name).toBe("VantageFRC");
    // Opens on an About tab that says what the file is; the empty default sheet is gone.
    expect(book.sheets[0]?.name).toBe("About");
    expect(book.sheets.some((sheet) => sheet.name === "Sheet1")).toBe(false);
    expect(book.sheets[0]?.cells[0]).toEqual(["Team", "6925 - Ctrl Alt Elite - VantageFRC"]);
    // Owners get view access, once.
    expect(book.viewers).toEqual(["owner@example.test"]);

    const again = await bridge.ensureTeamBook(TEAM);
    expect(again).toMatchObject({ id: first.id, created: false });
    expect(book.viewers).toEqual(["owner@example.test"]);
    // One team spreadsheet, plus the team index beside it.
    expect([...hub.books.values()].filter((b) => b.name !== "VantageFRC - Team index")).toHaveLength(1);
  });

  it("writes to the team's own spreadsheet and remembers what it wrote", async () => {
    const secret = newAppsScriptSecret();
    const hub = loadHub(secret);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: hub.fetchImpl });
    const other = { ...TEAM, key: "11111111-1111-4111-8111-111111111111", number: 254, name: "The Cheesy Poofs", viewers: [] };

    const target = new AppsScriptTarget(bridge, TEAM);
    const teams = { entity: "Teams" as const, sheet: "Teams", table: "VantageTeams", columns: ["id", "team_number"] };
    await target.ensureTable(teams);
    await target.replaceRows(teams, [["frc6925", 6925], ["frc254", 254]]);
    await target.flush();
    await bridge.stampTeamBook(TEAM, "abc123");

    const mine = await bridge.ensureTeamBook(TEAM);
    expect(mine.lastHash).toBe("abc123");
    expect(mine.lastSyncAt).toBeTruthy();
    const written = hub.books.get(mine.id)!.sheets.find((sheet) => sheet.name === "Teams");
    expect(written?.cells[0]).toEqual(["id", "team_number"]);
    expect(written?.cells).toHaveLength(3);

    // Another team gets its own file and none of this team's rows.
    const theirs = await bridge.ensureTeamBook(other);
    expect(theirs.id).not.toBe(mine.id);
    expect(theirs.name).toBe("254 - The Cheesy Poofs - VantageFRC");
    expect(theirs.lastHash).toBeNull();
    expect(hub.books.get(theirs.id)!.sheets.some((sheet) => sheet.name === "Teams")).toBe(false);
  });

  it("takes the sheet away from someone who is no longer an owner or admin", async () => {
    const secret = newAppsScriptSecret();
    const hub = loadHub(secret);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: hub.fetchImpl });
    const first = await bridge.ensureTeamBook({ ...TEAM, viewers: ["owner@example.test", "old-admin@example.test"] });
    expect(hub.books.get(first.id)!.viewers.sort()).toEqual(["old-admin@example.test", "owner@example.test"]);
    await bridge.ensureTeamBook({ ...TEAM, viewers: ["owner@example.test"] });
    expect(hub.books.get(first.id)!.viewers).toEqual(["owner@example.test"]);
  });

  it("fills a replacement sheet even when the team's data hasn't changed", async () => {
    const secret = newAppsScriptSecret();
    const hub = loadHub(secret);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: hub.fetchImpl });
    const first = await bridge.ensureTeamBook(TEAM);
    await bridge.stampTeamBook(TEAM, "abc123");
    hub.books.get(first.id)!.trashed = true;
    const replacement = await bridge.ensureTeamBook(TEAM);
    expect(replacement).toMatchObject({ created: true, lastHash: null });
    expect(replacement.id).not.toBe(first.id);
  });

  it("follows a team rename", async () => {
    const secret = newAppsScriptSecret();
    const hub = loadHub(secret);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: hub.fetchImpl });
    const first = await bridge.ensureTeamBook(TEAM);
    const renamed = await bridge.ensureTeamBook({ ...TEAM, name: "Ctrl Alt Elite Robotics" });
    expect(renamed.id).toBe(first.id);
    expect(renamed.name).toBe("6925 - Ctrl Alt Elite Robotics - VantageFRC");
  });

  it("gives a brand-new team its whole spreadsheet at once: every table, the catalog and the summary", async () => {
    const secret = newAppsScriptSecret();
    const hub = loadHub(secret);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: hub.fetchImpl });
    const team = { key: "22222222-2222-4222-8222-222222222222", number: 9856, name: "Gear Foxes", title: "9856 - Gear Foxes - VantageFRC", viewers: [] };

    const book = await ensureHubSheetForNewTeam(team, bridge, () => new Date("2026-09-24T12:00:00Z"));
    expect(book?.name).toBe("9856 - Gear Foxes - VantageFRC");
    expect(book?.lastHash).toBeTruthy();

    const file = hub.books.get(book!.id)!;
    const tabs = file.sheets.map((sheet) => sheet.name);
    expect(tabs.slice(0, 2)).toEqual(["About", "Summary"]);
    for (const table of ["Teams", "Matches", "MatchScouting", "Members", "Hours", "Calendar", "Tasks", "Finance", "Sponsors", "RobotFailures", "Batteries", "Tables", "SyncInfo"]) {
      expect(tabs, table).toContain(table);
    }
    // Header rows are in place before there is any data.
    expect(file.sheets.find((sheet) => sheet.name === "Members")?.cells[0]?.[0]).toBe("id");
    // The summary is live formulas over the named tables, not numbers typed in.
    const summary = file.sheets.find((sheet) => sheet.name === "Summary")!.cells;
    expect(summary[0]).toEqual(["area", "measure", "value", "how it is worked out"]);
    const hours = summary.find((row) => row[1] === "Hours logged")!;
    expect(String(hours[2])).toMatch(/^=IFERROR\(SUM\(INDEX\(tbl_Hours,0,MATCH\("hours"/);
    const balance = summary.find((row) => row[1] === "Balance (USD)")!;
    expect(balance[2]).toBe("=C6-C7");
    expect(summary.findIndex((row) => row[1] === "Income (USD)")).toBe(5);

    // The first real sync with nothing new has nothing to do.
    const again = await bridge.ensureTeamBook(team);
    expect(again.lastHash).toBe(book!.lastHash);
  });

  it("uses the title Vantage sends, puts tabs in table order, and lists the team in the index", async () => {
    const secret = newAppsScriptSecret();
    const hub = loadHub(secret);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: hub.fetchImpl });
    const team = { ...TEAM, title: "6925 - Ctrl Alt Elite - VantageFRC" };
    const target = new AppsScriptTarget(bridge, team);
    const spec = (sheet: string) => ({ entity: sheet as "Teams", sheet, table: "Vantage" + sheet, columns: ["id", "value"] });
    for (const sheet of ["Members", "Teams", "Tables"]) {
      await target.ensureTable(spec(sheet));
      await target.replaceRows(spec(sheet), [["a", 1]]);
    }
    await target.flush();
    await bridge.stampTeamBook(team, "hash1", ["Teams", "Members", "Tables"]);

    const mine = await bridge.ensureTeamBook(team);
    const book = hub.books.get(mine.id)!;
    expect(book.name).toBe("6925 - Ctrl Alt Elite - VantageFRC");
    expect(book.sheets.map((sheet) => sheet.name)).toEqual(["About", "Summary", "Teams", "Members", "Tables"]);

    const index = [...hub.books.values()].find((b) => b.name === "VantageFRC - Team index")!;
    expect(index.parent).toBe(book.parent);
    const rows = index.sheets.find((sheet) => sheet.name === "Teams")!.cells;
    expect(rows[0]).toEqual(["team_number", "team_name", "spreadsheet", "last_updated", "spreadsheet_id", "key"]);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.[0]).toBe(6925);
    expect(String(rows[1]?.[2])).toContain(book.id);
    expect(rows[1]?.[5]).toBe(TEAM.key);
  });
});

describe("hub configuration", () => {
  it("is on only with a real web app address and a 64-hex secret", () => {
    const secret = "a".repeat(64);
    expect(sheetsHubConfig({ VANTAGE_SHEETS_HUB_URL: URL_OK, VANTAGE_SHEETS_HUB_SECRET: secret } as NodeJS.ProcessEnv)).toEqual({ url: URL_OK, secret });
    expect(sheetsHubConfig({ VANTAGE_SHEETS_HUB_URL: URL_OK } as NodeJS.ProcessEnv)).toBeNull();
    expect(sheetsHubConfig({ VANTAGE_SHEETS_HUB_URL: "https://evil.example/exec", VANTAGE_SHEETS_HUB_SECRET: secret } as NodeJS.ProcessEnv)).toBeNull();
    expect(sheetsHubConfig({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("names every team's sheet the same way", () => {
    expect(teamSheetTitle(6925, "  Ctrl   Alt Elite ")).toBe("6925 - Ctrl Alt Elite - VantageFRC");
    expect(teamSheetTitle(null, "Rookie Team")).toBe("Rookie Team - VantageFRC");
    expect(teamSheetTitle(254, "")).toBe("254 - VantageFRC");
  });
});
