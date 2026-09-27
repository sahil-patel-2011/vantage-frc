import { createHmac } from "node:crypto";
import { randomBytes } from "node:crypto";
import { EnvKeyKmsService } from "@vantage/billing";
import { readRecoveryRecord, writeRecoveryRecord } from "../recovery/sheets";
import { describe, expect, it, vi } from "vitest";
import { AppsScriptBridge, AppsScriptTarget } from "./apps-script-bridge";
import { APPS_SCRIPT_VERSION, appsScriptSource, newAppsScriptSecret } from "./apps-script-source";
import { emptyTeamSource, ensureHubSheetForNewTeam, sheetsHubConfig, syncTeamToHub, teamSheetTitle } from "./sheets-hub";
import { loadWorkbookSource } from "../microsoft/workbook-sync";
import type { PoolClient } from "@neondatabase/serverless";
import { GoogleSheetsError } from "./google-api";

vi.mock("../microsoft/workbook-sync", async (original) => ({
  ...await original<typeof import("../microsoft/workbook-sync")>(),
  loadWorkbookSource: vi.fn(),
}));

const URL_OK = "https://script.google.com/macros/s/AKfycbxHUB1234567890abcdefghijk/exec";

/**
 * The script deployed on its own (hub mode): no active spreadsheet, a Drive with folders and
 * files, and SpreadsheetApp.create/openById. Just enough of Google to run the real script.
 */
function loadHub(secret: string, failFormatting: () => boolean = () => false, failAccess: (kind: "book" | "folder" | "file") => boolean = () => false, failSummary: () => boolean = () => false) {
  type Sheet = { name: string; cells: unknown[][]; frozenRows?: number; frozenColumns?: number; filtered?: boolean };
  type Book = { id: string; name: string; sheets: Sheet[]; parent: string | null; trashed: boolean; viewers: string[] };
  let seq = 0;
  let lockHeld = false;
  const books = new Map<string, Book>();
  const folders = new Map<string, { id: string; name: string; trashed: boolean; parent?: string }>();
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
      // Formula strings are asserted below; calculation is verified separately
      // against real Google. This fake models successful/failed display read-back.
      getDisplayValues: () => Array.from({ length: rows }, (_, i) => Array.from({ length: cols ?? 1 }, (_, j) => {
        const value = sheet.cells[row - 1 + i]?.[col - 1 + j] ?? "";
        return typeof value === "string" && value.startsWith("=") ? (failSummary() ? "#REF!" : "0") : String(value);
      })),
      getValue: () => sheet.cells[row - 1]?.[col - 1] ?? "",
      createFilter: () => { sheet.filtered = true; },
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
      getBandings: () => { if (failFormatting()) throw new Error("Required layout failed."); return []; },
      getFilter: () => sheet.filtered ? { remove: () => { sheet.filtered = false; } } : null,
      setFrozenRows: (value: number) => { sheet.frozenRows = value; },
      setFrozenColumns: (value: number) => { sheet.frozenColumns = value; },
      getFrozenRows: () => sheet.frozenRows ?? 0,
      getFrozenColumns: () => sheet.frozenColumns ?? 0,
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
      flush: () => {},
      getActiveSpreadsheet: () => null,
      create: (name: string) => {
        const book: Book = { id: `book${++seq}`, name, sheets: [{ name: "Sheet1", cells: [] }], parent: null, trashed: false, viewers: [] };
        books.set(book.id, book);
        return bookApi(book);
      },
      openById: (id: string) => {
        if (failAccess("book")) throw new Error("Temporary provider read failure.");
        const book = books.get(id);
        if (!book) throw new Error("not found");
        return bookApi(book);
      },
    },
    DriveApp: {
      getFilesByName: (name: string) => iter([...books.values()].filter((book) => book.name === name && !book.trashed).map((book) => ({ getId: () => book.id }))),
      getFolderById: (id: string) => {
        if (failAccess("folder")) throw new Error("Temporary provider read failure.");
        const folder = folders.get(id);
        if (!folder) throw new Error("not found");
        return { getId: () => folder.id, getName: () => folder.name, getUrl: () => `https://drive.google.com/drive/folders/${folder.id}`, isTrashed: () => folder.trashed,
          getFilesByName: (name: string) => iter([...books.values()].filter((book) => book.parent === id && book.name === name && !book.trashed).map((book) => ({ getId: () => book.id }))),
          getFoldersByName: (name: string) => iter([...folders.values()].filter((child) => child.parent === id && child.name === name && !child.trashed).map((child) => globals.DriveApp.getFolderById(child.id))),
          createFolder: (name: string): unknown => { const child = globals.DriveApp.createFolder(name); folders.get(child.getId())!.parent = id; return child; },
        };
      },
      getFoldersByName: (name: string) =>
        iter([...folders.values()].filter((f) => f.name === name).map((f) => globals.DriveApp.getFolderById(f.id))),
      createFolder: (name: string) => {
        const folder = { id: `folder${++seq}`, name, trashed: false };
        folders.set(folder.id, folder);
        return globals.DriveApp.getFolderById(folder.id);
      },
      getFileById: (id: string) => {
        if (failAccess("file")) throw new Error("Temporary provider read failure.");
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
    LockService: { getScriptLock: () => ({ hasLock: () => lockHeld, waitLock() { if (lockHeld) throw new Error("Nested script lock"); lockHeld = true; }, releaseLock() { lockHeld = false; } }) },
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

describe("protected paginated recovery", () => {
  it("keeps identified test recovery resources separate from a live resource with the same book key", async () => {
    const secret = newAppsScriptSecret();
    const hub = loadHub(secret);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: hub.fetchImpl });
    const kms = new EnvKeyKmsService(randomBytes(32).toString("base64"));
    const testRun = "c604d935-2aef-4808-a823-d4f6c3361264";
    const live = await writeRecoveryRecord(bridge, "Shared-key", "record", "live record", kms, {});
    const test = await writeRecoveryRecord(bridge, "Shared-key", "record", "test record", kms, { testRun });
    expect(test.spreadsheetId).not.toBe(live.spreadsheetId);
    expect(await readRecoveryRecord(bridge, live.bookKey, live.id, kms, {})).toBe("live record");
    expect(await readRecoveryRecord(bridge, test.bookKey, test.id, kms, { testRun })).toBe("test record");
    const parent = hub.folders.get(hub.books.get(test.spreadsheetId)!.parent!);
    expect(parent?.name).toBe("Recovery");
    expect(hub.folders.get(parent!.parent!)?.name).toBe(testRun);
  });
  it("round-trips more than one Google page and reuses the same resource on retry", async () => {
    const secret = newAppsScriptSecret();
    const hub = loadHub(secret);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: hub.fetchImpl });
    const kms = new EnvKeyKmsService(randomBytes(32).toString("base64"));
    const text = randomBytes(750000).toString("base64") + "🤖123456789012345678901234567890";
    const first = await writeRecoveryRecord(bridge, "Snapshot-test", "snapshot-test", text, kms);
    expect(await readRecoveryRecord(bridge, first.bookKey, first.id, kms)).toBe(text);
    const retried = await writeRecoveryRecord(bridge, "Snapshot-test", "snapshot-test", text, kms);
    expect(retried.spreadsheetId).toBe(first.spreadsheetId);
    expect([...hub.books.values()].filter((book) => book.name === "Vantage Recovery - Snapshot-test")).toHaveLength(1);
    const book = hub.books.get(first.spreadsheetId)!;
    expect(book.viewers).toEqual([]);
    expect(book.sheets.find((sheet) => sheet.name === "R-snapshot-test")!.cells.length).toBeGreaterThan(21);
  });
});

const TEAM = { key: "6925a000-0000-4000-8000-000000000001", number: 6925, name: "Ctrl  Alt Elite", viewers: ["Owner@Example.test"] };

describe("team sheets in the VantageFRC folder", () => {
  it("retains registered resources when Google temporarily cannot open them", async () => {
    let failedKind: "book" | "folder" | "file" | null = null;
    const secret = newAppsScriptSecret();
    const hub = loadHub(secret, () => false, (kind) => kind === failedKind);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: hub.fetchImpl });
    const first = await bridge.ensureTeamBook(TEAM);
    const bookCount = hub.books.size;
    const folderCount = hub.folders.size;
    for (const kind of ["book", "file", "folder"] as const) {
      failedKind = kind;
      // A different team exercises the existing hub folder lookup too.
      await expect(bridge.ensureTeamBook(kind === "folder" ? { ...TEAM, key: "another-team" } : TEAM)).rejects.toThrow("Temporary provider read failure");
      expect(hub.books.size).toBe(bookCount);
      expect(hub.folders.size).toBe(folderCount);
      failedKind = null;
      expect((await bridge.ensureTeamBook(TEAM)).id).toBe(first.id);
    }
  });
  it("does not stamp a partial layout as complete and repairs it on retry", async () => {
    let fail = true;
    const secret = newAppsScriptSecret();
    const hub = loadHub(secret, () => fail);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: hub.fetchImpl });
    const target = new AppsScriptTarget(bridge, TEAM);
    const spec = { entity: "Tasks" as const, sheet: "Tasks", table: "VantageTasks", columns: ["id", "title"] };
    await target.ensureTable(spec);
    await target.replaceRows(spec, [["task-1", "Inspect drivetrain"]]);
    await target.flush();
    const first = await bridge.ensureTeamBook(TEAM);
    await expect(bridge.stampTeamBook(TEAM, "complete", ["Tasks"])).rejects.toThrow(/layout failed/);
    expect((await bridge.ensureTeamBook(TEAM)).lastHash).toBeNull();
    fail = false;
    await bridge.stampTeamBook(TEAM, "complete", ["Tasks"]);
    expect((await bridge.ensureTeamBook(TEAM)).id).toBe(first.id);
    expect(await bridge.call("team.layout", { team: TEAM, sheets: ["Tasks"] })).toMatchObject({ layout: { Tasks: { frozenRows: 1, frozenColumns: 1, filtered: true } } });
    expect((await bridge.ensureTeamBook(TEAM)).lastHash).toBe("complete");
  });
  it("keeps controlled provisioning tests out of the operator's team index", async () => {
    const secret = newAppsScriptSecret();
    const hub = loadHub(secret);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: hub.fetchImpl });
    const id = "00000000-0000-4000-8000-000000000000";
    await bridge.ensureTeamBook({ key: `test-${id}`, rootKey: `test-${id}`, name: "Acceptance", number: null, viewers: [], testRun: id });
    expect([...hub.books.values()].some((book) => book.name === "VantageFRC - Team index")).toBe(false);
    expect([...hub.folders.values()].some((folder) => folder.name === id)).toBe(true);
  });
  it("adopts a workbook left between creation and resource registration", async () => {
    const secret = newAppsScriptSecret();
    const hub = loadHub(secret);
    hub.books.set("orphan", { id: "orphan", name: `Vantage pending workbook - ${TEAM.key}`, parent: null, trashed: false, viewers: [], sheets: [{ name: "Sheet1", cells: [] }] });
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: hub.fetchImpl });
    const first = await bridge.ensureTeamBook(TEAM);
    const retried = await bridge.ensureTeamBook(TEAM);
    expect(first.id).toBe("orphan");
    expect(retried.id).toBe(first.id);
    expect(hub.books.get(first.id)?.name).toBe("6925 - Ctrl Alt Elite - VantageFRC");
    expect([...hub.books.values()].filter((book) => book.name.includes("6925"))).toHaveLength(1);
  });
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

  it("gives an administratively created team the same five verified workspace books", async () => {
    const secret = newAppsScriptSecret();
    const hub = loadHub(secret);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: hub.fetchImpl });
    const team = { key: "22222222-2222-4222-8222-222222222222", number: 9856, name: "Gear Foxes", title: "9856 - Gear Foxes - VantageFRC", viewers: [] };

    const book = await ensureHubSheetForNewTeam(team, bridge, () => new Date("2026-09-24T12:00:00Z"));
    expect(book?.name).toBe("Competition");
    expect(book?.lastHash).toBeTruthy();

    const file = hub.books.get(book!.id)!;
    const tabs = file.sheets.map((sheet) => sheet.name);
    expect(tabs.slice(0, 2)).toEqual(["About", "Summary"]);
    for (const table of ["Teams", "Matches", "MatchScouting", "RobotFailures", "Batteries", "Tables", "SyncInfo"]) {
      expect(tabs, table).toContain(table);
    }
    expect(tabs).not.toContain("Finance");
    const teamBook = [...hub.books.values()].find(book => book.name === "Team")!;
    const businessBook = [...hub.books.values()].find(book => book.name === "Business")!;
    // Header rows are in place before there is any data.
    expect(teamBook.sheets.find((sheet) => sheet.name === "Members")?.cells[0]?.[0]).toBe("id");
    // The summary is live formulas over the named tables, not numbers typed in.
    const summary = businessBook.sheets.find((sheet) => sheet.name === "Summary")!.cells;
    expect(summary[0]).toEqual(["area", "measure", "value", "how it is worked out"]);
    expect(summary.some((row) => row[1] === "Hours logged" || row[1] === "Members")).toBe(false);
    const teamSummary = teamBook.sheets.find((sheet) => sheet.name === "Summary")!.cells;
    expect(String(teamSummary.find((row) => row[1] === "Hours logged")![2])).toMatch(/^=SUM\(INDEX\(tbl_Hours,0,MATCH\("hours"/);
    const balance = summary.find((row) => row[1] === "Recorded balance (USD)")!;
    expect(String(balance[2])).toContain('MATCH("counts_in_balance"');
    expect(String(balance[2])).toContain('"income"');
    expect(String(balance[2])).toContain('"expense"');
    expect(String(balance[2])).not.toMatch(/C\d|IFERROR/);
    for (const workspace of [...hub.books.values()].filter((book) => ["Start Here", "Competition", "Team", "Build", "Business"].includes(book.name))) {
      const workspaceSummary = workspace.sheets.find((sheet) => sheet.name === "Summary")!.cells;
      for (const row of workspaceSummary.slice(1)) {
        for (const reference of String(row[2]).matchAll(/tbl_([A-Za-z0-9_]+)/g)) {
          expect(workspace.sheets.some((sheet) => sheet.name === reference[1]), `${workspace.name}: ${row[1]}`).toBe(true);
        }
      }
    }

    // The first real sync with nothing new has nothing to do.
    const again = await bridge.ensureTeamBook({ ...team, rootKey: team.key, title: "Competition" });
    expect(again.lastHash).toBe(book!.lastHash);
  });

  it("does not stamp a successful sync when a Summary formula fails and reuses the same workbook on retry", async () => {
    let failing = true;
    const secret = newAppsScriptSecret();
    const hub = loadHub(secret, () => false, () => false, () => failing);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: hub.fetchImpl });
    const target = new AppsScriptTarget(bridge, TEAM);
    const table = { entity: "Teams" as const, sheet: "Teams", table: "VantageTeams", columns: ["id", "team_number"] };
    await target.ensureTable(table);
    await target.replaceRows(table, [["one", 6925]]);
    await target.flush();
    const original = await bridge.ensureTeamBook(TEAM);
    await expect(bridge.stampTeamBook(TEAM, "successful-hash", ["Teams"])).rejects.toThrow("Summary formula verification failed");
    expect((await bridge.ensureTeamBook(TEAM)).lastHash).toBeNull();
    failing = false;
    await bridge.stampTeamBook(TEAM, "successful-hash", ["Teams"]);
    expect(await bridge.ensureTeamBook(TEAM)).toMatchObject({ id: original.id, lastHash: "successful-hash" });
  });

  it("preserves older Finance copies while explicitly marking unknown inclusion totals", async () => {
    const secret = newAppsScriptSecret();
    const hub = loadHub(secret);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: hub.fetchImpl });
    const target = new AppsScriptTarget(bridge, TEAM);
    const table = { entity: "Finance" as const, sheet: "Finance", table: "VantageFinance", columns: ["id", "type", "amount_usd"] };
    await target.ensureTable(table);
    await target.replaceRows(table, [["legacy", "expense", 500]]);
    await target.flush();
    await bridge.stampTeamBook(TEAM, "legacy-data", ["Finance"]);
    const book = await bridge.ensureTeamBook(TEAM);
    const summary = hub.books.get(book.id)!.sheets.find((sheet) => sheet.name === "Summary")!.cells;
    expect(summary.slice(1)).toEqual([["Money", "Included ledger totals", "Unavailable", expect.stringContaining("lacks counts_in_balance")]]);
    expect(hub.books.get(book.id)!.sheets.find((sheet) => sheet.name === "Finance")!.cells).toEqual([["id", "type", "amount_usd"], ["legacy", "expense", 500]]);
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

describe("five-workspace hub refresh", () => {
  const orgId = "33333333-3333-4333-8333-333333333333";
  const team = { key: orgId, number: 99999, name: "Synthetic refresh" };
  function clientFor(state = "ready") {
    const resources = { workbooks: {} as Record<string, { id: string; hash: string }> };
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("advisory")) return { rows: [{ locked: true }] };
      if (sql.includes("SELECT name, team_number")) return { rows: [{ name: team.name, teamNumber: team.number }] };
      if (sql.includes("SELECT state,verified_at")) return { rows: [{ state, verified: state === "ready", resources }] };
      if (sql.includes("UPDATE team_provisioning_jobs")) Object.assign(resources.workbooks, JSON.parse(String(values[1])));
      return { rows: [] };
    });
    return { client: { query } as unknown as PoolClient, query };
  }
  it("refreshes changed Team and Business books, preserves the other books and reuses all five resources", async () => {
    const secret = newAppsScriptSecret();
    const hub = loadHub(secret);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: hub.fetchImpl });
    const { client, query } = clientFor();
    const source = emptyTeamSource(team);
    vi.mocked(loadWorkbookSource).mockResolvedValue(source);
    expect((await syncTeamToHub(client, orgId, { bridge })).status).toBe("succeeded");
    const workspaceFiles = [...hub.books.values()].filter(book => ["Start Here", "Competition", "Team", "Build", "Business"].includes(book.name));
    expect(workspaceFiles).toHaveLength(5);
    const ids = workspaceFiles.map(book => book.id);
    source.ops = { Tasks: [{ id: "task-1", title: "Repair intake", status: "open" }], Finance: [{ id: "finance-1", type: "expense", amount_usd: 12.5 }] };
    const calls = vi.spyOn(bridge, "call");
    expect((await syncTeamToHub(client, orgId, { bridge })).status).toBe("succeeded");
    expect(calls.mock.calls.filter(([action]) => action === "write").map(([, payload]) => (payload?.team as { title: string }).title)).toEqual(["Team", "Business"]);
    const competition = workspaceFiles.find(book => book.name === "Competition")!;
    expect(competition.sheets.some(sheet => sheet.name === "Tasks" || sheet.name === "Finance")).toBe(false);
    expect(workspaceFiles.find(book => book.name === "Team")!.sheets.find(sheet => sheet.name === "Tasks")!.cells[1]).toContain("Repair intake");
    expect(workspaceFiles.find(book => book.name === "Business")!.sheets.find(sheet => sheet.name === "Finance")!.cells[1]).toContain(12.5);
    expect(workspaceFiles.map(book => book.id)).toEqual(ids);
    calls.mockClear();
    expect((await syncTeamToHub(client, orgId, { bridge })).status).toBe("unchanged");
    expect(calls.mock.calls.some(([action]) => action === "write" || action === "read" || action === "team.stamp")).toBe(false);
    expect(query.mock.calls.filter(([sql]) => sql.includes("UPDATE team_provisioning_jobs"))).toHaveLength(15);
    expect(loadWorkbookSource).toHaveBeenLastCalledWith(client, orgId, { strict: true });
  });
  it("does not replace a good copy when a database read fails, or start copying an unready team", async () => {
    const secret = newAppsScriptSecret();
    const hub = loadHub(secret);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: hub.fetchImpl });
    const { client } = clientFor();
    vi.mocked(loadWorkbookSource).mockRejectedValueOnce(new Error("Source read failed"));
    expect((await syncTeamToHub(client, orgId, { bridge })).status).toBe("failed");
    expect(hub.books.size).toBe(0);
    expect((await syncTeamToHub(clientFor("running").client, orgId, { bridge })).status).toBe("setup_required");
    expect(hub.books.size).toBe(0);
  });
  it("reports a failed stamp and retries it without duplicating resources or claiming freshness", async () => {
    const secret = newAppsScriptSecret();
    let failStamp = true;
    const hub = loadHub(secret);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: hub.fetchImpl });
    const call = bridge.call.bind(bridge);
    bridge.call = async (action, payload) => {
      if (action === "team.stamp" && (payload?.team as { title?: string }).title === "Team" && failStamp) throw new GoogleSheetsError("unavailable", "Google could not save the freshness stamp.", null, "test_stamp_failure", null, "Google could not save the freshness stamp.");
      return call(action, payload);
    };
    const { client, query } = clientFor();
    vi.mocked(loadWorkbookSource).mockResolvedValue(emptyTeamSource(team));
    const result = await syncTeamToHub(client, orgId, { bridge });
    expect(result.status).toBe("partial");
    expect("error" in result && result.error).toContain("freshness stamp");
    expect(query.mock.calls.filter(([sql]) => sql.includes("UPDATE team_provisioning_jobs"))).toHaveLength(2);
    const retained = [...hub.books.values()].find(book => book.name === "Team")!.id;
    failStamp = false;
    expect((await syncTeamToHub(client, orgId, { bridge })).status).toBe("succeeded");
    expect([...hub.books.values()].find(book => book.name === "Team")!.id).toBe(retained);
  });
  it("rechecks an unregistered remote stamp after a failed layout read", async () => {
    const secret = newAppsScriptSecret();
    const hub = loadHub(secret);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: hub.fetchImpl });
    const call = bridge.call.bind(bridge);
    let fail = true;
    let teamLayoutReads = 0;
    bridge.call = async (action, payload) => {
      if (action === "team.layout" && (payload?.team as { title?: string }).title === "Team") {
        teamLayoutReads++;
        if (fail) throw new Error("Layout read interrupted after remote stamp");
      }
      return call(action, payload);
    };
    const { client } = clientFor();
    vi.mocked(loadWorkbookSource).mockResolvedValue(emptyTeamSource(team));
    expect((await syncTeamToHub(client, orgId, { bridge })).status).toBe("partial");
    fail = false;
    expect((await syncTeamToHub(client, orgId, { bridge })).status).toBe("succeeded");
    expect(teamLayoutReads).toBe(2);
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
