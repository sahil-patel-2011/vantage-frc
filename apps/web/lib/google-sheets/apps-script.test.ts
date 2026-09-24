import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AppsScriptBridge, AppsScriptTarget, asciiJson, bridgeSpreadsheetId, bridgeUrlOf } from "./apps-script-bridge";
import { checkAppsScript } from "./connect-apps-script";
import { driveFolderIdFrom, listDriveMedia, setUpDriveMedia, testDriveMedia } from "../google-drive/drive-media";
import { APPS_SCRIPT_VERSION, appsScriptSource, isAppsScriptUrl, newAppsScriptSecret } from "./apps-script-source";

const URL_OK = "https://script.google.com/macros/s/AKfycbx1234567890abcdefghijkLMNOP/exec";

/**
 * Runs the real Apps Script source in Node against a fake Google: SpreadsheetApp,
 * Utilities, ContentService and LockService behave like the documented services, backed by
 * an in-memory spreadsheet. This is what catches a syntax slip or a protocol mismatch
 * before a coach pastes the script.
 */
function loadScript(secret: string) {
  type Sheet = { name: string; cells: unknown[][]; maxRows: number; maxCols: number; frozen: number; formats: unknown[][] };
  const sheets = new Map<string, Sheet>();
  const sheetApi = (sheet: Sheet) => ({
    clearContents() {
      sheet.cells = [];
    },
    getMaxRows: () => sheet.maxRows,
    getMaxColumns: () => sheet.maxCols,
    insertRowsAfter(_after: number, n: number) {
      sheet.maxRows += n;
    },
    insertColumnsAfter(_after: number, n: number) {
      sheet.maxCols += n;
    },
    setFrozenRows(n: number) {
      sheet.frozen = n;
    },
    getRange(row: number, col: number, rows: number, cols: number) {
      if (row + rows - 1 > sheet.maxRows || col + cols - 1 > sheet.maxCols) throw new Error("Range exceeds grid");
      return {
        setValues(values: unknown[][]) {
          if (values.length !== rows || values.some((r) => r.length !== cols)) throw new Error("dimension mismatch");
          values.forEach((r, i) => {
            sheet.cells[row - 1 + i] = [...r];
          });
        },
        setNumberFormats(formats: unknown[][]) {
          sheet.formats = formats;
        },
        setFontWeight() {},
      };
    },
    getDataRange() {
      return { getValues: () => sheet.cells.map((r) => [...r]) };
    },
  });
  const book = {
    getName: () => "Team 6925 copy",
    getUrl: () => "https://docs.google.com/spreadsheets/d/abc/edit",
    getSheetByName: (name: string) => (sheets.has(name) ? sheetApi(sheets.get(name)!) : null),
    insertSheet(name: string) {
      const sheet = { name, cells: [], maxRows: 1000, maxCols: 26, frozen: 0, formats: [] };
      sheets.set(name, sheet);
      return sheetApi(sheet);
    },
  };
  // A small in-memory Drive: folders, files, sharing, and thumbnails for images.
  type FolderRow = { id: string; name: string; parent: string | null; trashed: boolean; sharing: string };
  type FileRow = { id: string; name: string; parent: string; mime: string; content: string; trashed: boolean; updated: Date };
  let seq = 0;
  const folders = new Map<string, FolderRow>();
  const files = new Map<string, FileRow>();
  const props = new Map<string, string>();
  const iter = <T,>(items: T[]) => {
    let i = 0;
    return { hasNext: () => i < items.length, next: () => items[i++]! };
  };
  const fileApi = (row: FileRow) => ({
    getId: () => row.id,
    getName: () => row.name,
    getMimeType: () => row.mime,
    getSize: () => row.content.length,
    getLastUpdated: () => row.updated,
    getUrl: () => `https://drive.google.com/file/d/${row.id}/view`,
    getThumbnail: () => (row.mime.startsWith("image/") ? { getContentType: () => "image/png", getBytes: () => [1, 2, 3] } : null),
    getBlob: () => ({ getDataAsString: () => row.content }),
    setTrashed: (value: boolean) => {
      row.trashed = value;
    },
  });
  const folderApi = (row: FolderRow): Record<string, unknown> => ({
    getId: () => row.id,
    getName: () => row.name,
    getUrl: () => `https://drive.google.com/drive/folders/${row.id}`,
    isTrashed: () => row.trashed,
    getFoldersByName: (name: string) =>
      iter([...folders.values()].filter((f) => f.parent === row.id && f.name === name && !f.trashed).map(folderApi)),
    createFolder: (name: string) => {
      const child = { id: `folder${++seq}abcdefghij`, name, parent: row.id, trashed: false, sharing: "PRIVATE" };
      folders.set(child.id, child);
      return folderApi(child);
    },
    getFiles: () => iter([...files.values()].filter((f) => f.parent === row.id && !f.trashed).map(fileApi)),
    createFile: (name: string, content: string, mime: string) => {
      const file = { id: `file${++seq}abcdefghij`, name, parent: row.id, mime, content, trashed: false, updated: new Date() };
      files.set(file.id, file);
      return fileApi(file);
    },
    setSharing: (access: string) => {
      row.sharing = access;
    },
    getSharingAccess: () => row.sharing,
  });
  const drive = {
    Access: { ANYONE_WITH_LINK: "ANYONE_WITH_LINK", PRIVATE: "PRIVATE" },
    Permission: { VIEW: "VIEW", NONE: "NONE" },
    getFolderById: (id: string) => {
      const row = folders.get(id);
      if (!row) throw new Error("No item with the given ID could be found.");
      return folderApi(row);
    },
    createFolder: (name: string) => {
      const row = { id: `folder${++seq}abcdefghij`, name, parent: null, trashed: false, sharing: "PRIVATE" };
      folders.set(row.id, row);
      return folderApi(row);
    },
  };
  /** Put a file straight into a named subfolder, the way a person would in Drive. */
  const addFile = (folderName: string, name: string, mime: string) => {
    const folder = [...folders.values()].find((f) => f.name === folderName);
    if (!folder) throw new Error(`no folder ${folderName}`);
    files.set(`file${++seq}abcdefghij`, { id: `file${seq}abcdefghij`, name, parent: folder.id, mime, content: "x".repeat(2048), trashed: false, updated: new Date(Date.now() + seq) });
  };

  const globals = {
    DriveApp: drive,
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (key: string) => props.get(key) ?? null, setProperty: (key: string, value: string) => props.set(key, value) }),
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => book },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      // Apps Script returns signed bytes (-128..127).
      computeHmacSha256Signature: (value: string, key: string) =>
        [...createHmac("sha256", key).update(value).digest()].map((b) => (b > 127 ? b - 256 : b)),
      formatDate: (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z"),
      base64Encode: (bytes: number[]) => Buffer.from(bytes).toString("base64"),
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (text: string) => ({ text, setMimeType() { return this; } }),
    },
  };
  const factory = new Function(
    ...Object.keys(globals),
    `${appsScriptSource(secret)}\nreturn { doPost, doGet };`,
  ) as (...args: unknown[]) => { doPost: (e: unknown) => { text: string }; doGet: () => { text: string } };
  const script = factory(...Object.values(globals));
  return { script, sheets, addFile, folders };
}

/** A fetch that delivers Vantage's signed request to the loaded script, like Google would. */
function googleFetch(script: ReturnType<typeof loadScript>["script"]) {
  const calls: string[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method} ${url.split("?")[0]}`);
    if (init?.method === "POST") {
      const sig = new URL(url).searchParams.get("sig") ?? "";
      const out = script.doPost({ postData: { contents: String(init.body) }, parameter: { sig } });
      // Google answers a web-app POST with a redirect to the output.
      return new Response(null, {
        status: 302,
        headers: { location: `https://script.googleusercontent.com/macros/echo?k=${encodeURIComponent(out.text)}` },
      });
    }
    const text = new URL(url).searchParams.get("k") ?? "";
    return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
  };
  return { impl: impl as typeof fetch, calls };
}

describe("the Apps Script bridge", () => {
  it("accepts only real Apps Script web app addresses", () => {
    expect(isAppsScriptUrl(URL_OK)).toBe(true);
    expect(isAppsScriptUrl("https://evil.example/macros/s/AKfycbx1234567890abcdefghijk/exec")).toBe(false);
    expect(isAppsScriptUrl("https://script.google.com/macros/s/AKfycbx1234567890abcdefghijk/dev")).toBe(false);
    expect(bridgeUrlOf(bridgeSpreadsheetId(URL_OK))).toBe(URL_OK);
    expect(bridgeUrlOf("1AbCdEfG")).toBeNull();
  });

  it("pings, writes a workbook in one call, and reads it back", async () => {
    const secret = newAppsScriptSecret();
    const { script, sheets } = loadScript(secret);
    const { impl, calls } = googleFetch(script);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: impl });
    await expect(bridge.ping()).resolves.toMatchObject({ version: APPS_SCRIPT_VERSION, name: "Team 6925 copy" });

    const target = new AppsScriptTarget(bridge);
    const pick = { entity: "PickList" as const, sheet: "PickList", table: "VantagePickList", columns: ["id", "rank", "notes"] };
    const teams = { entity: "Teams" as const, sheet: "Teams", table: "VantageTeams", columns: ["id", "team_number"] };
    await target.ensureTable(teams);
    await target.replaceRows(teams, Array.from({ length: 1_500 }, (_, i) => [`frc${i}`, i]));
    await target.ensureTable(pick);
    await target.replaceRows(pick, [["a", 1, null]]);
    calls.length = 0;
    await target.flush();
    expect(calls.filter((call) => call.startsWith("POST"))).toHaveLength(1);
    // 1500 rows fit because the script grows the 1000-row grid; blanks land as "".
    expect(sheets.get("Teams")!.cells).toHaveLength(1_501);
    expect(sheets.get("PickList")!.cells).toEqual([["id", "rank", "notes"], ["a", 1, ""]]);
    expect(sheets.get("Teams")!.frozen).toBe(1);
    expect(sheets.get("PickList")!.formats).toEqual([["@", "@", "@"], ["@", "General", "@"]]);

    const read = await new AppsScriptTarget(bridge).readTable({ entity: "PickList", sheet: "PickList", table: "VantagePickList" });
    expect(read).toEqual({ headers: ["id", "rank", "notes"], rows: [["a", 1, ""]], truncated: false });
    expect(await new AppsScriptTarget(bridge).readTable({ entity: "PitScouting", sheet: "PitScouting", table: "VantagePitScouting" })).toBeNull();
  });

  it("refuses a request signed with another secret, and one replayed too late", async () => {
    const { script } = loadScript(newAppsScriptSecret());
    const wrong = new AppsScriptBridge(URL_OK, newAppsScriptSecret(), { fetchImpl: googleFetch(script).impl });
    await expect(wrong.ping()).rejects.toMatchObject({ kind: "auth_expired", code: "signature" });

    const secret = newAppsScriptSecret();
    const loaded = loadScript(secret);
    const late = new AppsScriptBridge(URL_OK, secret, { fetchImpl: googleFetch(loaded.script).impl, now: () => Date.now() - 10 * 60_000 });
    await expect(late.ping()).rejects.toMatchObject({ code: "stale" });
  });

  it("signs an all-ASCII body so Apps Script's charset cannot change it", () => {
    const body = asciiJson({ note: "Team 6925 — Peña 🤖", n: 1 });
    expect(/^[\x20-\x7e]*$/.test(body)).toBe(true);
    expect(JSON.parse(body)).toEqual({ note: "Team 6925 — Peña 🤖", n: 1 });
  });

  it("explains a deployment that is not open to Anyone", async () => {
    const html = (async () => new Response("<html>Sign in</html>", { status: 200 })) as typeof fetch;
    const bridge = new AppsScriptBridge(URL_OK, newAppsScriptSecret(), { fetchImpl: html });
    await expect(bridge.ping()).rejects.toMatchObject({ kind: "forbidden", code: "not_public" });
  });

  it("never follows a redirect off Google's script host", async () => {
    const evil = (async () => new Response(null, { status: 302, headers: { location: "https://evil.example/x" } })) as typeof fetch;
    const bridge = new AppsScriptBridge(URL_OK, newAppsScriptSecret(), { fetchImpl: evil });
    await expect(bridge.ping()).rejects.toMatchObject({ code: "bad_redirect" });
  });

  it("checks pasted values before anything is saved", async () => {
    const secret = newAppsScriptSecret();
    const { script } = loadScript(secret);
    const fetchImpl = googleFetch(script).impl;
    expect(await checkAppsScript({ url: "https://example.com/x", secret }, { fetchImpl })).toMatchObject({ ok: false, code: "bad_url" });
    expect(await checkAppsScript({ url: URL_OK, secret: "short" }, { fetchImpl })).toMatchObject({ ok: false, code: "bad_secret" });
    expect(await checkAppsScript({ url: URL_OK, secret: newAppsScriptSecret() }, { fetchImpl })).toMatchObject({ ok: false, code: "unreachable" });
    // Pasted with stray spaces and capitals, as people do.
    const ok = await checkAppsScript({ url: ` ${URL_OK} `, secret: ` ${secret.toUpperCase()} ` }, { fetchImpl });
    expect(ok).toEqual({ ok: true, url: URL_OK, secret, name: "Team 6925 copy", fileUrl: "https://docs.google.com/spreadsheets/d/abc/edit" });
  });
});

describe("photos and videos through the same script", () => {
  it("sets up an organized folder, tiles what people add, and passes its own test", async () => {
    const secret = newAppsScriptSecret();
    const loaded = loadScript(secret);
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: googleFetch(loaded.script).impl });

    // Before setup: listing is empty and the test says what to do.
    await expect(listDriveMedia(bridge)).resolves.toEqual({ root: null, shared: false, folders: [] });
    const early = await testDriveMedia(bridge);
    expect(early.passed).toBe(false);
    expect(early.steps.at(-1)?.detail).toMatch(/Set up folder/);

    const setup = await setUpDriveMedia(bridge, { team: "Team 6925", rootId: "", shareWithLink: true });
    expect(setup.root.name).toBe("Vantage media - Team 6925");
    expect(setup.folders.map((folder) => folder.name)).toEqual([
      "Match videos",
      "Robot photos",
      "Pit and build",
      "Outreach and events",
      "CAD renders",
      "Other",
    ]);
    // Running setup again reuses the same folders instead of making duplicates.
    await setUpDriveMedia(bridge, { team: "Team 6925", rootId: "", shareWithLink: null });
    expect([...loaded.folders.values()].filter((folder) => folder.name === "Robot photos")).toHaveLength(1);

    loaded.addFile("Robot photos", "bumper.jpg", "image/jpeg");
    loaded.addFile("Match videos", "qm12.mp4", "video/mp4");
    const listing = await listDriveMedia(bridge);
    expect(listing.shared).toBe(true);
    const photos = listing.folders.find((folder) => folder.key === "robot-photos")!;
    expect(photos.files[0]).toMatchObject({ name: "bumper.jpg", mimeType: "image/jpeg", size: 2048, thumb: "data:image/png;base64,AQID" });
    expect(listing.folders.find((folder) => folder.key === "match-videos")!.files[0]).toMatchObject({ name: "qm12.mp4", thumb: null });

    const test = await testDriveMedia(bridge);
    expect(test.passed).toBe(true);
    expect(test.steps.map((step) => step.step)).toContain("Read it back");
  });

  it("asks a version-1 script to be updated instead of failing with a code", async () => {
    const secret = newAppsScriptSecret();
    const old = loadScript(secret);
    const oldPing = old.script.doPost;
    // A version-1 script answers ping with version 1.
    const script = {
      ...old.script,
      doPost: (e: unknown) => {
        const out = oldPing(e);
        return { text: out.text.replace(/"version":\d+/, '"version":1') };
      },
    };
    const bridge = new AppsScriptBridge(URL_OK, secret, { fetchImpl: googleFetch(script).impl });
    await expect(listDriveMedia(bridge)).rejects.toMatchObject({ code: "old_version" });
  });

  it("reads a Drive folder link or id and rejects anything else", () => {
    expect(driveFolderIdFrom("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing")).toBe("1AbCdEfGhIjKlMnOp");
    expect(driveFolderIdFrom("1AbCdEfGhIjKlMnOp")).toBe("1AbCdEfGhIjKlMnOp");
    expect(driveFolderIdFrom("")).toBe("");
    expect(driveFolderIdFrom("not a folder!")).toBeNull();
  });
});
