/**
 * Google Sheets without Google Cloud: a small Apps Script the team pastes into its own
 * spreadsheet (Extensions → Apps Script) and deploys as a web app. Vantage then sends the
 * tables to that web app instead of calling the Sheets API — no Cloud project, no OAuth
 * client, nothing to enable, and it runs under the owner's own Google account.
 *
 * Pure and dependency-free so the Connectors card can build the script in the browser.
 *
 * Protocol (APPS_SCRIPT_VERSION 1): POST <web app URL>?sig=<hex HMAC-SHA256(secret, body)>
 * with a JSON body { action, ts, ... }. Apps Script cannot read request headers, so the
 * signature rides in the query string over exactly the bytes of the body. The script
 * refuses a bad signature or a timestamp more than five minutes off, so the public web app
 * URL alone reads and writes nothing.
 *   ping  → { ok, version, name, url }
 *   write → { items: [{ sheet, startRow, width, values, clear }] } → { ok, cells }
 *   read  → { sheets: [name] } → { ok, values: { [name]: rows | null } }
 */

export const APPS_SCRIPT_VERSION = 2;
/** The oldest script Vantage still talks to (spreadsheet sync only). */
export const APPS_SCRIPT_MIN_VERSION = 1;
/** Photos and videos in Google Drive need this version of the script. */
export const APPS_SCRIPT_DRIVE_VERSION = 2;

/** Only real Apps Script web-app URLs: Vantage never sends team data anywhere else. */
export const APPS_SCRIPT_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/;

export function isAppsScriptUrl(url: string): boolean {
  return APPS_SCRIPT_URL.test(url.trim());
}

/** 32 random bytes as hex. Works in the browser and in Node (Web Crypto). */
export function newAppsScriptSecret(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isAppsScriptSecret(secret: string): boolean {
  return /^[0-9a-f]{64}$/.test(secret);
}

/** The script the owner pastes. The secret is the only thing that differs per team. */
export function appsScriptSource(secret: string): string {
  if (!isAppsScriptSecret(secret)) throw new Error("Apps Script secret must be 64 hex characters");
  return `/**
 * Vantage → Google Sheets and Drive bridge (version ${APPS_SCRIPT_VERSION}).
 *
 * Paste this into Extensions → Apps Script of the spreadsheet Vantage should keep up to
 * date, then Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone.
 * Vantage signs every request with the secret below; anything unsigned is refused, so the
 * web app address alone cannot read or change anything. It only touches this spreadsheet
 * and the one "Vantage media" Drive folder it makes (or the folder you pick in Vantage).
 * Keep the secret private — it is what makes the address safe to share.
 */
const VANTAGE_SECRET = "${secret}";
const VANTAGE_VERSION = ${APPS_SCRIPT_VERSION};
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function doPost(e) {
  try {
    const body = (e && e.postData && e.postData.contents) || "";
    const sig = (e && e.parameter && e.parameter.sig) || "";
    if (!vantageSignatureOk_(body, sig)) return vantageReply_({ ok: false, error: "signature" });
    const request = JSON.parse(body);
    if (!(Math.abs(Date.now() - Number(request.ts)) <= MAX_CLOCK_SKEW_MS)) {
      return vantageReply_({ ok: false, error: "stale" });
    }
    const book = SpreadsheetApp.getActiveSpreadsheet();
    if (request.action === "ping") {
      return vantageReply_({ ok: true, version: VANTAGE_VERSION, name: book.getName(), url: book.getUrl() });
    }
    if (request.action === "write") return vantageReply_(vantageWrite_(book, request.items || []));
    if (request.action === "read") return vantageReply_(vantageRead_(book, request.sheets || []));
    if (request.action === "drive.setup") return vantageReply_(vantageDriveSetup_(request));
    if (request.action === "drive.list") return vantageReply_(vantageDriveList_(request));
    if (request.action === "drive.test") return vantageReply_(vantageDriveTest_());
    return vantageReply_({ ok: false, error: "unknown action" });
  } catch (err) {
    return vantageReply_({ ok: false, error: String((err && err.message) || err).slice(0, 300) });
  }
}

function doGet() {
  return vantageReply_({ ok: true, service: "vantage-sheets-bridge", version: VANTAGE_VERSION });
}

function vantageWrite_(book, items) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let cells = 0;
  try {
    for (const item of items) {
      const sheet = book.getSheetByName(item.sheet) || book.insertSheet(item.sheet);
      if (item.clear) sheet.clearContents();
      const rows = item.values.length;
      const width = Math.max(1, item.width);
      const lastRow = item.startRow + rows - 1;
      if (sheet.getMaxRows() < lastRow) sheet.insertRowsAfter(sheet.getMaxRows(), lastRow - sheet.getMaxRows());
      if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
      if (rows > 0) {
        const range = sheet.getRange(item.startRow, 1, rows, width);
        // Text stays text: without this, Sheets would turn a timestamp or "00123" into a
        // date or a number on the way in. Numbers and true/false keep their own types.
        try {
          range.setNumberFormats(item.values.map((row) => row.map((cell) => (typeof cell === "string" ? "@" : "General"))));
        } catch (formatError) {
          // Formatting is a nicety; the values still land.
        }
        range.setValues(item.values);
        cells += rows * width;
      }
      if (item.startRow === 1) {
        sheet.getRange(1, 1, 1, width).setFontWeight("bold");
        sheet.setFrozenRows(1);
      }
    }
  } finally {
    lock.releaseLock();
  }
  return { ok: true, cells: cells };
}

function vantageRead_(book, names) {
  const values = {};
  for (const name of names) {
    const sheet = book.getSheetByName(name);
    values[name] = sheet
      ? sheet.getDataRange().getValues().map((row) =>
          row.map((cell) =>
            cell instanceof Date ? Utilities.formatDate(cell, "UTC", "yyyy-MM-dd'T'HH:mm:ss'Z'") : cell,
          ),
        )
      : null;
  }
  return { ok: true, values: values };
}

// ---------------------------------------------------------------- photos and videos
// One folder in the owner's Drive holds the team's media, split into the folders below.
// Vantage lists them (with small thumbnails) to tile them in the app; people add files
// straight into Drive, so there is no size limit.
const VANTAGE_DRIVE_FOLDERS = [
  ["match-videos", "Match videos"],
  ["robot-photos", "Robot photos"],
  ["pit-build", "Pit and build"],
  ["outreach", "Outreach and events"],
  ["cad", "CAD renders"],
  ["other", "Other"],
];
const VANTAGE_ROOT_KEY = "VANTAGE_DRIVE_ROOT";

function vantageFolderInfo_(folder) {
  return { id: folder.getId(), name: folder.getName(), url: folder.getUrl() };
}

function vantageDriveRoot_(create, rootId, teamName) {
  const props = PropertiesService.getScriptProperties();
  const id = rootId || props.getProperty(VANTAGE_ROOT_KEY);
  if (id) {
    try {
      const found = DriveApp.getFolderById(id);
      if (!found.isTrashed()) {
        props.setProperty(VANTAGE_ROOT_KEY, found.getId());
        return found;
      }
    } catch (missing) {
      if (rootId) throw new Error("That Drive folder was not found, or this Google account cannot open it.");
    }
  }
  if (!create) return null;
  const folder = DriveApp.createFolder(teamName ? "Vantage media - " + teamName : "Vantage media");
  props.setProperty(VANTAGE_ROOT_KEY, folder.getId());
  return folder;
}

function vantageSubfolder_(root, name, create) {
  const found = root.getFoldersByName(name);
  if (found.hasNext()) return found.next();
  return create ? root.createFolder(name) : null;
}

function vantageDriveSetup_(request) {
  const root = vantageDriveRoot_(true, String(request.rootId || ""), String(request.team || "").slice(0, 80));
  const folders = VANTAGE_DRIVE_FOLDERS.map((entry) => {
    const folder = vantageSubfolder_(root, entry[1], true);
    return { key: entry[0], name: entry[1], id: folder.getId(), url: folder.getUrl() };
  });
  if (request.shareWithLink === true) root.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  if (request.shareWithLink === false) root.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  return { ok: true, root: vantageFolderInfo_(root), folders: folders };
}

function vantageDriveList_(request) {
  const root = vantageDriveRoot_(false, "", "");
  if (!root) return { ok: true, root: null, shared: false, folders: [] };
  const limit = Math.min(Math.max(Number(request.limit) || 60, 1), 200);
  let thumbnails = request.thumbnails === false ? 0 : 48;
  const folders = VANTAGE_DRIVE_FOLDERS.map((entry) => {
    const folder = vantageSubfolder_(root, entry[1], false);
    if (!folder) return { key: entry[0], name: entry[1], id: null, url: null, files: [], more: false };
    const found = [];
    const it = folder.getFiles();
    while (it.hasNext() && found.length < limit) found.push(it.next());
    found.sort((a, b) => b.getLastUpdated().getTime() - a.getLastUpdated().getTime());
    const files = found.map((file) => {
      const mimeType = file.getMimeType();
      let thumb = null;
      if (thumbnails > 0 && (mimeType.indexOf("image/") === 0 || mimeType.indexOf("video/") === 0)) {
        try {
          const blob = file.getThumbnail();
          if (blob) {
            thumb = "data:" + blob.getContentType() + ";base64," + Utilities.base64Encode(blob.getBytes());
            thumbnails -= 1;
          }
        } catch (noThumb) {
          // Drive has not made one yet (a video still processing).
        }
      }
      return {
        id: file.getId(),
        name: file.getName(),
        mimeType: mimeType,
        size: file.getSize(),
        updated: file.getLastUpdated().toISOString(),
        url: file.getUrl(),
        thumb: thumb,
      };
    });
    return { key: entry[0], name: entry[1], id: folder.getId(), url: folder.getUrl(), files: files, more: it.hasNext() };
  });
  const shared = root.getSharingAccess() === DriveApp.Access.ANYONE_WITH_LINK;
  return { ok: true, root: vantageFolderInfo_(root), shared: shared, folders: folders };
}

function vantageDriveTest_() {
  const steps = [];
  const root = vantageDriveRoot_(false, "", "");
  if (!root) {
    steps.push({ step: "Find the media folder", ok: false, detail: "No media folder yet. Press Set up folder first." });
    return { ok: true, passed: false, steps: steps };
  }
  steps.push({ step: "Find the media folder", ok: true, detail: root.getName() });
  const stamp = "Vantage test " + new Date().toISOString();
  const file = root.createFile("vantage-test.txt", stamp, "text/plain");
  steps.push({ step: "Write a test file", ok: true, detail: file.getName() });
  const back = file.getBlob().getDataAsString();
  steps.push({ step: "Read it back", ok: back === stamp, detail: back === stamp ? "Matches" : "Did not match" });
  file.setTrashed(true);
  steps.push({ step: "Clean up", ok: true, detail: "Moved the test file to Drive's trash" });
  return { ok: true, passed: steps.every((s) => s.ok), steps: steps };
}

function vantageSignatureOk_(body, sig) {
  if (typeof sig !== "string" || sig.length !== 64) return false;
  const mac = Utilities.computeHmacSha256Signature(body, VANTAGE_SECRET)
    .map((byte) => ((byte + 256) % 256).toString(16).padStart(2, "0"))
    .join("");
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= mac.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

function vantageReply_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
`;
}
