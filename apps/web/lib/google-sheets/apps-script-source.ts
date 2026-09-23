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

export const APPS_SCRIPT_VERSION = 1;

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
 * Vantage → Google Sheets bridge (version ${APPS_SCRIPT_VERSION}).
 *
 * Paste this into Extensions → Apps Script of the spreadsheet Vantage should keep up to
 * date, then Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone.
 * Vantage signs every request with the secret below; anything unsigned is refused, so the
 * web app address alone cannot read or change this spreadsheet. It only ever touches this
 * spreadsheet. Keep the secret private — it is what makes the address safe to share.
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
