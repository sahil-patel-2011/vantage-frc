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
 *
 * Version 3 adds hub mode. The same script, deployed on its own (script.google.com → New
 * project) instead of inside one spreadsheet, keeps one spreadsheet per team in a
 * "VantageFRC" folder of the Google account that deployed it. Every request that carries
 * `team: { key, number, name, viewers }` works on that team's spreadsheet:
 *   team.ensure → { ok, id, url, name, created, lastHash, lastSyncAt }
 *   team.stamp  → { team, hash } → { ok }   (after a full write; the next sync skips if unchanged)
 *   write/read  → as above, on the team's spreadsheet
 *
 * Version 4 lays each team's spreadsheet out like a database. team.stamp takes `order` (the
 * tables in write order) and then formats every table tab (header row, frozen id column,
 * filter, banding, column formats, a named range, a warning-only protection) and puts the
 * tabs in order. Each spreadsheet is named "6925 - Team Name - VantageFRC" (or `team.title`),
 * and a "VantageFRC - Team index" spreadsheet in the same folder lists every team with a link.
 * `ping { hub: true }` answers as a hub even when the script sits inside a spreadsheet, which
 * then becomes that index.
 */

export const APPS_SCRIPT_VERSION = 7;
export const APPS_SCRIPT_WORKSPACE_VERSION = 7;
/** Hub mode (one spreadsheet per team in a VantageFRC folder) needs this version. */
export const APPS_SCRIPT_HUB_VERSION = 3;
/** The oldest script Vantage still talks to (spreadsheet sync only). */
export const APPS_SCRIPT_MIN_VERSION = 1;
/** Photos and videos in Google Drive need this version of the script. */
export const APPS_SCRIPT_DRIVE_VERSION = 2;

/**
 * Only real Apps Script web-app URLs: Vantage never sends team data anywhere else. A Google
 * Workspace account (a school domain) deploys under /a/macros/<domain>/s/…/exec.
 */
export const APPS_SCRIPT_URL =
  /^https:\/\/script\.google\.com\/(?:macros|a\/macros\/[A-Za-z0-9.-]{1,100})\/s\/[A-Za-z0-9_-]{20,200}\/exec$/;

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

/** Vantage's own origin, safe to embed in the script: https, a host, an optional port. */
export function isVantageOrigin(value: string): boolean {
  return /^https?:\/\/[A-Za-z0-9.-]{1,200}(?::\d{1,5})?$/.test(value);
}

/**
 * The text the script signs to register its own address, and the server checks. Registration
 * is valid for a day after the address page was opened.
 */
export function hubRegistrationMessage(url: string, ts: number): string {
  return `register|${url}|${ts}`;
}
export const HUB_REGISTRATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The script the owner pastes. The secret is the only thing that differs per team. `appUrl`
 * (the hub script from Admin → Integrations) adds a page at the web app address with a
 * "Connect to Vantage" button, so the platform owner never copies the address by hand.
 */
export function appsScriptSource(secret: string, options: { appUrl?: string | null } = {}): string {
  if (!isAppsScriptSecret(secret)) throw new Error("Apps Script secret must be 64 hex characters");
  const appUrl = options.appUrl && isVantageOrigin(options.appUrl) ? options.appUrl : "";
  return `/**
 * Vantage → Google Sheets and Drive bridge (version ${APPS_SCRIPT_VERSION}).
 *
 * For one team: paste this into Extensions → Apps Script of the spreadsheet Vantage should
 * keep up to date. For every team (hub): paste it into a new project at script.google.com.
 * Then Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone.
 * Vantage signs every request with the secret below; anything unsigned is refused, so the
 * web app address alone cannot read or change anything. It manages Vantage team workbooks
 * and encrypted recovery copies in the operator's VantageFRC folder.
 * Keep the secret private — it is what makes the address safe to share.
 */
const VANTAGE_SECRET = "${secret}";
const VANTAGE_VERSION = ${APPS_SCRIPT_VERSION};
// Where "Connect to Vantage" sends the platform owner (empty for a team's own script).
const VANTAGE_APP_URL = "${appUrl}";
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
// Personal Gmail: all Vantage creations share one conservative rolling-day ledger.
// This measures this bridge's attempts, not Google's remaining quota or other scripts.
const VANTAGE_CREATE_LIMIT = 250;
const VANTAGE_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
const VANTAGE_CREATE_LEDGER = "VANTAGE_CREATE_LEDGER";

function vantageQuotaError_(retryAfterMs) {
  const error = new Error("Google's daily spreadsheet creation allowance is in use. Setup progress is saved and will resume automatically.");
  error.code = "daily_quota";
  error.retryAfterMs = Math.max(1000, Math.min(VANTAGE_QUOTA_WINDOW_MS, retryAfterMs));
  return error;
}

function vantageCreateSpreadsheet_(title) {
  const lock = LockService.getScriptLock();
  const acquired = !lock.hasLock();
  if (acquired) lock.waitLock(30000);
  try {
    // Recover a create that succeeded before its response or registration was lost.
    const existing = DriveApp.getFilesByName(title);
    if (existing.hasNext()) return SpreadsheetApp.openById(existing.next().getId());
    const props = PropertiesService.getScriptProperties();
    const now = Date.now();
    const stored = props.getProperty(VANTAGE_CREATE_LEDGER);
    const ledger = stored ? JSON.parse(stored) : { attempts: [], blockedUntil: 0 };
    if (!Array.isArray(ledger.attempts) || ledger.attempts.some((at) => !Number.isFinite(at)) || !Number.isFinite(ledger.blockedUntil)) throw new Error("Spreadsheet quota ledger needs operator attention.");
    ledger.attempts = ledger.attempts.filter((at) => at > now - VANTAGE_QUOTA_WINDOW_MS).sort((a, b) => a - b);
    if (ledger.blockedUntil > now) throw vantageQuotaError_(ledger.blockedUntil - now);
    if (ledger.attempts.length >= VANTAGE_CREATE_LIMIT) throw vantageQuotaError_(ledger.attempts[0] + VANTAGE_QUOTA_WINDOW_MS - now);
    // Reserve before calling Google. An ambiguous failure still consumes a reservation.
    ledger.attempts.push(now);
    props.setProperty(VANTAGE_CREATE_LEDGER, JSON.stringify(ledger));
    try { return SpreadsheetApp.create(title); }
    catch (error) {
      if (/limit exceeded.*spreadsheet|^service invoked too many times:|too many times.*(?:day|daily)|daily.*quota/i.test(String(error.message || error))) {
        ledger.blockedUntil = now + VANTAGE_QUOTA_WINDOW_MS;
        props.setProperty(VANTAGE_CREATE_LEDGER, JSON.stringify(ledger));
        throw vantageQuotaError_(VANTAGE_QUOTA_WINDOW_MS);
      }
      throw error;
    }
  } finally { if (acquired) lock.releaseLock(); }
}

function doPost(e) {
  try {
    const body = (e && e.postData && e.postData.contents) || "";
    const sig = (e && e.parameter && e.parameter.sig) || "";
    if (!vantageSignatureOk_(body, sig)) return vantageReply_({ ok: false, error: "signature" });
    const request = JSON.parse(body);
    if (!(Math.abs(Date.now() - Number(request.ts)) <= MAX_CLOCK_SKEW_MS)) {
      return vantageReply_({ ok: false, error: "stale" });
    }
    if (request.action === "ping") {
      const active = SpreadsheetApp.getActiveSpreadsheet();
      if (active && request.hub !== true) {
        return vantageReply_({ ok: true, version: VANTAGE_VERSION, name: active.getName(), url: active.getUrl() });
      }
      const hub = vantageHubFolder_();
      const index = vantageIndexBook_();
      return vantageReply_({ ok: true, version: VANTAGE_VERSION, hub: true, name: hub.getName(), url: hub.getUrl(), indexUrl: index.getUrl() });
    }
    if (request.action === "team.ensure") return vantageReply_(vantageTeamEnsure_(request.team || {}));
    if (request.action === "team.layout") return vantageReply_(vantageTeamLayout_(request.team || {}, request.sheets || []));
    if (request.action === "workspace.ensure") return vantageReply_(vantageWorkspaceEnsure_(request.team || {}));
    if (request.action === "recovery.write") return vantageReply_(vantageRecoveryWrite_(request));
    if (request.action === "recovery.read") return vantageReply_(vantageRecoveryRead_(request));
    if (request.action === "recovery.inspect") return vantageReply_(vantageRecoveryInspect_(request));
    if (request.action === "team.stamp") {
      return vantageReply_(vantageTeamStamp_(request.team || {}, String(request.hash || ""), request.order || []));
    }
    if (request.action === "write") return vantageReply_(vantageWrite_(vantageBook_(request), request.items || []));
    if (request.action === "read") return vantageReply_(vantageRead_(vantageBook_(request), request.sheets || []));
    if (request.action === "drive.setup") return vantageReply_({ ok: false, error: "Photo and video storage setup is no longer supported." });
    if (request.action === "drive.list") return vantageReply_(vantageDriveList_(request));
    if (request.action === "drive.test") return vantageReply_(vantageDriveTest_());
    return vantageReply_({ ok: false, error: "unknown action" });
  } catch (err) {
    return vantageReply_({ ok: false, error: String((err && err.message) || err).slice(0, 300),
      code: err && err.code === "daily_quota" ? "daily_quota" : undefined,
      retryAfterMs: err && err.code === "daily_quota" ? err.retryAfterMs : undefined });
  }
}

// Run manually in the operator's editor to verify the existing Google authorization.
function vantageOperatorCheck() {
  const folder = vantageHubFolder_();
  Logger.log(JSON.stringify({ version: VANTAGE_VERSION, folderId: folder.getId() }));
}

function doGet() {
  if (!VANTAGE_APP_URL) return vantageReply_({ ok: true, service: "vantage-sheets-bridge", version: VANTAGE_VERSION });
  // Opened in a browser after deploying: one button carries this script's own address, signed
  // with the secret, to Vantage, which stores it. Nobody copies the address by hand.
  const url = ScriptApp.getService().getUrl();
  const ts = Date.now();
  const sig = vantageHmacHex_("register|" + url + "|" + ts);
  const link = VANTAGE_APP_URL + "/admin/integrations?sheetsHub=" + encodeURIComponent(url) + "&ts=" + ts + "&sig=" + sig;
  const html =
    '<div style="font-family:system-ui,sans-serif;max-width:520px;margin:48px auto;line-height:1.5">' +
    "<h2>Team spreadsheets are ready to connect</h2>" +
    "<p>Press the button while signed in to Vantage as the platform admin. Vantage saves this address and starts making each team's spreadsheet.</p>" +
    '<p><a href="' + link + '" target="_top" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600">Connect to Vantage</a></p>' +
    "</div>";
  return HtmlService.createHtmlOutput(html).setTitle("Connect to Vantage");
}

function vantageHmacHex_(text) {
  return Utilities.computeHmacSha256Signature(text, VANTAGE_SECRET)
    .map((byte) => ((byte + 256) % 256).toString(16).padStart(2, "0"))
    .join("");
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
        range.setNumberFormats(item.values.map((row) => row.map((cell) => (typeof cell === "string" ? "@" : "General"))));
        // An apostrophe prevents formula execution and is not part of the value read back
        // by Sheets. Preserve a user's leading apostrophe by escaping it too.
        range.setValues(item.values.map((row) => row.map((cell) =>
          typeof cell === "string" && /^[=+\\-@']/.test(cell) ? "'" + cell : cell)));
        cells += rows * width;
      }
      if (item.startRow === 1) {
        const header = sheet.getRange(1, 1, 1, width);
        header.setFontWeight("bold");
        sheet.setFrozenRows(1);
        try {
          // A tinted header row and columns sized to their contents. Niceties: the values
          // are already in, so a failure here changes nothing that matters.
          header.setBackground("#EEF2F7");
          if (item.clear && rows > 0) sheet.autoResizeColumns(1, width);
        } catch (styleError) {
          // Keep going.
        }
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

// ---------------------------------------------------------------- hub: one spreadsheet per team
// Deployed on its own, this script keeps every team's spreadsheet in one "VantageFRC" folder,
// named the same way for every team: "6925 - Team Name - VantageFRC". Each spreadsheet opens
// on an About tab that says what it is and when it last changed.
const VANTAGE_HUB_FOLDER = "VantageFRC";
const VANTAGE_HUB_KEY = "VANTAGE_HUB_FOLDER";

function vantageHubFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(VANTAGE_HUB_KEY);
  if (id) {
    // An access or quota failure does not establish deletion. Retain the registered
    // resource and retry; only an explicitly trashed folder may be replaced.
    const found = DriveApp.getFolderById(id);
    if (!found.isTrashed()) return found;
  }
  const existing = DriveApp.getFoldersByName(VANTAGE_HUB_FOLDER);
  const folder = existing.hasNext() ? existing.next() : DriveApp.createFolder(VANTAGE_HUB_FOLDER);
  props.setProperty(VANTAGE_HUB_KEY, folder.getId());
  return folder;
}

function vantageTeamKey_(team) {
  const key = String(team.key || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 64);
  if (!key) throw new Error("A team key is required.");
  return key;
}

function vantageWorkspaceFolder_(team) {
  let root = vantageHubFolder_();
  if (team.testRun) {
    if (!/^[a-f0-9-]{36}$/.test(String(team.testRun)) || String(team.rootKey || team.key) !== "test-" + team.testRun) throw new Error("Invalid isolated test workspace.");
    root = vantageSubfolder_(vantageSubfolder_(root, "Tests", true), String(team.testRun), true);
  }
  const teams = vantageSubfolder_(root, "Teams", true);
  const rootKey = vantageTeamKey_({ key: team.rootKey || team.key });
  const props = PropertiesService.getScriptProperties();
  const property = "VANTAGE_TEAM_FOLDER_" + rootKey;
  const known = props.getProperty(property);
  const title = (team.number ? String(team.number) + " - " : "") + String(team.name || "Team").slice(0, 80) + " - " + rootKey;
  if (known) {
    const folder = DriveApp.getFolderById(known);
    if (!folder.isTrashed()) return folder;
  }
  const folder = vantageSubfolder_(teams, title, true);
  props.setProperty(property, folder.getId());
  return folder;
}

function vantageWorkspaceEnsure_(team) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const folder = vantageWorkspaceFolder_(team);
    vantageSubfolder_(vantageHubFolder_(), "Recovery", true);
    return { ok: true, folderId: folder.getId(), folderUrl: folder.getUrl() };
  } finally { lock.releaseLock(); }
}

// Recovery is operator-only, separate from readable team books. IDs and offsets are
// supplied by persistent application jobs; retries overwrite the same cells.
function vantageRecoveryBook_(key, create, testRun) {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(key)) throw new Error("Invalid recovery book key.");
  if (testRun && !/^[a-f0-9-]{36}$/.test(String(testRun))) throw new Error("Invalid isolated recovery test.");
  const props = PropertiesService.getScriptProperties();
  const property = "VANTAGE_RECOVERY_" + (testRun ? "TEST_" + testRun + "_" : "") + key;
  const known = props.getProperty(property);
  if (known) {
    const file = DriveApp.getFileById(known);
    if (!file.isTrashed()) return SpreadsheetApp.openById(known);
  }
  if (!create) throw new Error("Recovery workbook not found.");
  let root = vantageHubFolder_();
  if (testRun) root = vantageSubfolder_(vantageSubfolder_(root, "Tests", true), String(testRun), true);
  const folder = vantageSubfolder_(root, "Recovery", true);
  const title = "Vantage Recovery - " + (testRun ? "TEST-" + testRun + " - " : "") + key;
  const files = folder.getFilesByName(title);
  const book = files.hasNext() ? SpreadsheetApp.openById(files.next().getId()) : vantageCreateSpreadsheet_(title);
  props.setProperty(property, book.getId());
  DriveApp.getFileById(book.getId()).moveTo(folder);
  return book;
}
function vantageRecoveryTab_(id) {
  if (!/^[A-Za-z0-9-]{1,90}$/.test(id)) throw new Error("Invalid recovery record ID.");
  return "R-" + id;
}
function vantageRecoveryWrite_(request) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const book = vantageRecoveryBook_(String(request.bookKey || ""), true, request.testRun);
    const name = vantageRecoveryTab_(String(request.id || ""));
    const offset = Number(request.offset || 0);
    if (!Number.isInteger(offset) || offset < 0) throw new Error("Invalid recovery offset.");
    const parts = request.parts || [];
    if (!Array.isArray(parts) || parts.length > 20 || parts.some((part) => typeof part !== "string" || part.length > 40000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(part))) throw new Error("Invalid recovery parts.");
    const sheet = book.getSheetByName(name) || book.insertSheet(name);
    const rows = Math.max(2, offset + parts.length + 1);
    if (sheet.getMaxRows() < rows) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
    if (offset === 0) {
      sheet.clearContents();
      sheet.getRange(1, 1, 1, 2).setValues([["Envelope", JSON.stringify(request.envelope)]]);
      sheet.setFrozenRows(1);
      // Limit unused grid space so sharding reflects actual cells.
      if (sheet.getMaxColumns() > 2) sheet.deleteColumns(3, sheet.getMaxColumns() - 2);
    }
    if (parts.length) sheet.getRange(offset + 2, 1, parts.length, 2).setValues(parts.map((value, i) => [offset + i, value]));
    if (request.final) {
      if (sheet.getMaxRows() > rows) sheet.deleteRows(rows + 1, sheet.getMaxRows() - rows);
      const protection = sheet.protect().setDescription("Vantage encrypted recovery. Edit through the recovery service only.");
      protection.removeEditors(protection.getEditors());
      if (protection.canDomainEdit()) protection.setDomainEdit(false);
    }
    return { ok: true, id: book.getId() };
  } finally { lock.releaseLock(); }
}
function vantageRecoveryRead_(request) {
  const book = vantageRecoveryBook_(String(request.bookKey || ""), false, request.testRun);
  const sheet = book.getSheetByName(vantageRecoveryTab_(String(request.id || "")));
  if (!sheet) throw new Error("Recovery record not found.");
  const envelope = JSON.parse(sheet.getRange(1, 2).getValue());
  const offset = Number(request.offset || 0);
  const limit = Number(request.limit || 20);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("Invalid recovery page.");
  const count = Math.max(0, Math.min(limit, sheet.getLastRow() - 1 - offset));
  const rows = count ? sheet.getRange(offset + 2, 1, count, 2).getValues() : [];
  return { ok: true, envelope: envelope, parts: rows.filter((row) => row[1] !== "").map((row) => ({ index: Number(row[0]), value: String(row[1]) })) };
}
function vantageRecoveryInspect_(request) {
  const book = vantageRecoveryBook_(String(request.bookKey || ""), false, request.testRun);
  const file = DriveApp.getFileById(book.getId());
  const sheet = book.getSheetByName(vantageRecoveryTab_(String(request.id || "")));
  if (!sheet) throw new Error("Recovery record not found.");
  return { ok: true, id: book.getId(), sharingAccess: String(file.getSharingAccess()),
    viewers: file.getViewers().length, externalEditors: file.getEditors().filter((user) => user.getEmail() !== file.getOwner().getEmail()).length,
    protected: sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length > 0 };
}

function vantageTeamTitle_(team) {
  const given = String(team.title || "").replace(/[\\u0000-\\u001f]/g, "").replace(/\\s+/g, " ").trim().slice(0, 120);
  if (given) return given;
  const name = String(team.name || "").replace(/\\s+/g, " ").trim().slice(0, 80);
  const number = String(team.number || "").replace(/[^0-9]/g, "").slice(0, 6);
  if (number && name) return number + " - " + name + " - VantageFRC";
  if (number) return number + " - VantageFRC";
  return (name || "Team") + " - VantageFRC";
}

function vantageTeamBook_(team, create) {
  const key = vantageTeamKey_(team);
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("VANTAGE_BOOK_" + key);
  const title = vantageTeamTitle_(team);
  if (id) {
    const file = DriveApp.getFileById(id);
    if (!file.isTrashed()) {
      const book = SpreadsheetApp.openById(id);
      if (book.getName() !== title) book.rename(title);
      if (team.rootKey) file.moveTo(vantageWorkspaceFolder_(team));
      return { book: book, created: false };
    }
  }
  if (!create) return null;
  const folder = team.rootKey ? vantageWorkspaceFolder_(team) : vantageHubFolder_();
  const existing = folder.getFilesByName(title);
  // A crash between create() and property registration leaves a uniquely named file.
  // Recover it by its stable key rather than creating another workbook on retry.
  const pendingTitle = "Vantage pending workbook - " + key;
  const pending = DriveApp.getFilesByName(pendingTitle);
  const book = existing.hasNext() ? SpreadsheetApp.openById(existing.next().getId())
    : pending.hasNext() ? SpreadsheetApp.openById(pending.next().getId()) : vantageCreateSpreadsheet_(pendingTitle);
  props.setProperty("VANTAGE_BOOK_" + key, book.getId());
  DriveApp.getFileById(book.getId()).moveTo(folder);
  if (book.getName() !== title) book.rename(title);
  // A new file holds none of the old data: forget what was written to the old one, so the
  // next sync fills it instead of calling it unchanged. Its sharing starts over too.
  props.deleteProperty("VANTAGE_HASH_" + key);
  props.deleteProperty("VANTAGE_AT_" + key);
  props.deleteProperty("VANTAGE_SHARED_" + key);
  return { book: book, created: true };
}

function vantageBook_(request) {
  if (request.team) return vantageTeamBook_(request.team, true).book;
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error("This script is not inside a spreadsheet. Send a team, or paste it into Extensions → Apps Script of a spreadsheet.");
  return active;
}

function vantageAbout_(book, team, lastSyncAt) {
  const sheet = book.getSheetByName("About") || book.insertSheet("About", 0);
  const rows = [
    ["Team", vantageTeamTitle_(team)],
    ["What this is", "This team's records, one tab per table. The Tables tab lists every table, what it holds and how many rows it has."],
    ["Summary", "The Summary tab adds up members, hours, money, scouting and robot records with live formulas."],
    ["Keys", "Every table starts with an id column. It never changes, so rows in different tabs can be matched on it."],
    ["Editing", "Change things in Vantage. Edits made here are replaced on the next update."],
    ["Last updated", lastSyncAt || "Not yet"],
  ];
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  sheet.getRange(1, 1, rows.length, 1).setFontWeight("bold");
  sheet.setColumnWidth(1, 140);
  sheet.setColumnWidth(2, 560);
  const blank = book.getSheetByName("Sheet1");
  if (blank && book.getSheets().length > 1 && blank.getLastRow() === 0) book.deleteSheet(blank);
}

// View access follows the team's current owners and admins: someone removed or demoted
// in Vantage loses the sheet on the next sync. Only addresses this script shared are ever
// removed, so people the Drive owner shared by hand are left alone.
function vantageShare_(book, team) {
  if (!Array.isArray(team.viewers)) return;
  const viewers = team.viewers.map((email) => String(email).trim().toLowerCase()).filter((email) => /^[^@\\s]+@[^@\\s]+$/.test(email)).slice(0, 20);
  const props = PropertiesService.getScriptProperties();
  const doneKey = "VANTAGE_SHARED_" + vantageTeamKey_(team);
  const done = (props.getProperty(doneKey) || "").split(",").filter(Boolean);
  const file = DriveApp.getFileById(book.getId());
  const kept = [];
  for (const email of done) {
    if (viewers.indexOf(email) >= 0) {
      kept.push(email);
      continue;
    }
    try {
      file.removeViewer(email);
    } catch (removeError) {
      // Already gone.
    }
  }
  for (const email of viewers) {
    if (kept.indexOf(email) >= 0) continue;
    try {
      file.addViewer(email);
      kept.push(email);
    } catch (shareError) {
      // An address Google cannot share with; the others still get access.
    }
  }
  props.setProperty(doneKey, kept.slice(-50).join(","));
}

function vantageTeamEnsure_(team) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const found = vantageTeamBook_(team, true);
    const props = PropertiesService.getScriptProperties();
    const key = vantageTeamKey_(team);
    if (found.created) vantageAbout_(found.book, team, "");
    vantageShare_(found.book, team);
    vantageIndexUpdate_(team, found.book, props.getProperty("VANTAGE_AT_" + key) || "");
    return {
      ok: true,
      id: found.book.getId(),
      url: found.book.getUrl(),
      name: found.book.getName(),
      created: found.created,
      lastHash: props.getProperty("VANTAGE_HASH_" + key) || null,
      lastSyncAt: props.getProperty("VANTAGE_AT_" + key) || null,
    };
  } finally {
    lock.releaseLock();
  }
}

function vantageTeamStamp_(team, hash, order) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
  const key = vantageTeamKey_(team);
  const found = vantageTeamBook_(team, false);
  if (!found) return { ok: false, error: "No spreadsheet for this team yet." };
  const at = new Date().toISOString();
  const props = PropertiesService.getScriptProperties();
  vantageAbout_(found.book, team, at);
  vantageFormatBook_(found.book, order);
  vantageIndexUpdate_(team, found.book, at);
  props.setProperty("VANTAGE_HASH_" + key, hash.slice(0, 64));
  props.setProperty("VANTAGE_AT_" + key, at);
  return { ok: true, at: at };
  } finally { lock.releaseLock(); }
}

function vantageTeamLayout_(team, names) {
  const found = vantageTeamBook_(team, false);
  if (!found) throw new Error("No spreadsheet for this team yet.");
  const layout = {};
  for (const name of names) {
    const sheet = found.book.getSheetByName(String(name));
    layout[name] = sheet ? { frozenRows: sheet.getFrozenRows(), frozenColumns: sheet.getFrozenColumns(), filtered: Boolean(sheet.getFilter()) } : null;
  }
  return { ok: true, layout: layout };
}

// ---------------------------------------------------------------- database layout
// After a full write, every table tab is laid out the same way: a dark header row that stays
// put, the id column frozen, a filter on every column, light banding, columns formatted by
// what they hold, a named range (tbl_<Tab>) for formulas, and a warning if someone types over
// data that the next update replaces. Tabs sit in a fixed order behind About.
const VANTAGE_EVENT_TABS = ["Teams", "Matches", "MatchScouting", "PitScouting", "PickList"];
const VANTAGE_INFO_TABS = ["Tables", "SyncInfo"];

function vantageFormatBook_(book, order) {
  const names = (Array.isArray(order) ? order : []).map(String).filter((name) => name && name !== "About").slice(0, 60);
  for (const name of names) {
    const sheet = book.getSheetByName(name);
    if (!sheet) throw new Error("A required table is missing: " + name);
    vantageFormatTable_(book, sheet);
  }
  vantageSummary_(book);
  const about = book.getSheetByName("About");
  const ordered = (about ? ["About"] : []).concat(book.getSheetByName("Summary") ? ["Summary"] : [], names);
  let position = 1;
  for (const name of ordered) {
    const sheet = book.getSheetByName(name);
    if (!sheet) continue;
    book.setActiveSheet(sheet);
    book.moveActiveSheet(position);
    position += 1;
  }
  if (about) book.setActiveSheet(about);
  const blank = book.getSheetByName("Sheet1");
  if (blank && book.getSheets().length > 1 && blank.getLastRow() === 0) book.deleteSheet(blank);
}

function vantageColumnFormat_(column, range) {
  const name = String(column).toLowerCase();
  // Keys and times stay text: ISO times sort correctly as text and never shift time zone.
  if (name === "id" || /_id$|_key$/.test(name)) return "@";
  if (/_at$|_on$|_time$|^clock_(in|out)$/.test(name)) return "@";
  if (/_usd$/.test(name)) return "$#,##0.00";
  const values = range.getValues().map((row) => row[0]).filter((value) => value !== "" && value !== null);
  if (values.length && values.every((value) => typeof value === "number")) {
    return values.every((value) => Math.round(value) === value) ? "0" : "#,##0.##";
  }
  return "General";
}

function vantageFormatTable_(book, sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;
  const lastRow = Math.max(sheet.getLastRow(), 1);
  const name = sheet.getName();
  const header = sheet.getRange(1, 1, 1, lastCol);
  const headers = header.getValues()[0].map(String);
  const table = sheet.getRange(1, 1, lastRow, lastCol);

  // Rebuilt each time over exactly the rows that are there now.
  sheet.getBandings().forEach((band) => band.remove());
  const oldFilter = sheet.getFilter();
  if (oldFilter) oldFilter.remove();

  const band = table.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
  band.setHeaderRowColor("#1F3A5F");
  header.setFontColor("#FFFFFF").setFontWeight("bold").setVerticalAlignment("middle");
  sheet.setRowHeight(1, 30);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(headers[0] === "id" ? 1 : 0);
  table.createFilter();
  table.setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

  if (lastRow > 1) {
    headers.forEach((column, index) => {
      const range = sheet.getRange(2, index + 1, lastRow - 1, 1);
      range.setNumberFormat(vantageColumnFormat_(column, range));
    });
  }

  // Exactly as big as the table, plus one empty row, so it reads as a table and not a grid.
  const maxRows = sheet.getMaxRows();
  if (maxRows > lastRow + 1) sheet.deleteRows(lastRow + 2, maxRows - lastRow - 1);
  const maxCols = sheet.getMaxColumns();
  if (maxCols > lastCol) sheet.deleteColumns(lastCol + 1, maxCols - lastCol);

  sheet.autoResizeColumns(1, lastCol);
  for (let col = 1; col <= lastCol; col++) {
    const width = sheet.getColumnWidth(col);
    if (width > 320) sheet.setColumnWidth(col, 320);
    else if (width < 72) sheet.setColumnWidth(col, 72);
  }

  book.setNamedRange("tbl_" + name.replace(/[^A-Za-z0-9_]/g, "_"), table);
  sheet.setTabColor(
    VANTAGE_EVENT_TABS.indexOf(name) >= 0 ? "#1F4FD6" : VANTAGE_INFO_TABS.indexOf(name) >= 0 ? "#6B7280" : "#0F8A5F",
  );
  if (!sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
    sheet.protect().setDescription("Kept up to date by Vantage. Edits here are replaced on the next update.").setWarningOnly(true);
  }
}

// ---------------------------------------------------------------- summary
// Live formulas over the named tables (tbl_<Tab>), so the numbers follow the data between
// updates and anyone can see how each one is worked out. Only this book's tables
// contribute measures. Missing tables and failed formulas never become recorded zeroes.
function vantageCol_(table, column) {
  return "INDEX(tbl_" + table + ",0,MATCH(\\"" + column + "\\",INDEX(tbl_" + table + ",1,0),0))";
}

function vantageSummary_(book) {
  const financeSheet = book.getSheetByName("Finance");
  const financeHeaders = financeSheet ? financeSheet.getRange(1, 1, 1, financeSheet.getLastColumn()).getValues()[0] : [];
  const financeInclusionAvailable = financeHeaders.indexOf("counts_in_balance") >= 0;
  const rowsOf = (table) => "=MAX(ROWS(tbl_" + table + ")-1,0)";
  const sumOf = (table, column) => "=SUM(" + vantageCol_(table, column) + ")";
  const countOf = (table, column, value) => "=COUNTIF(" + vantageCol_(table, column) + ",\\"" + value + "\\")";
  const sumIf = (table, column, value, amount) =>
    "SUMIFS(" + vantageCol_(table, amount) + "," + vantageCol_(table, column) + ",\\"" + value + "\\"," + vantageCol_(table, "counts_in_balance") + ",TRUE)";
  const candidates = [
    ["Team", "Members", rowsOf("Members"), "Everyone on the team"],
    ["Team", "Hours logged", sumOf("Hours", "hours"), "Total of the hours column in Hours"],
    ["Team", "Open tasks", "=COUNTA(" + vantageCol_("Tasks", "status") + ")-1-COUNTIF(" + vantageCol_("Tasks", "status") + ",\\"done\\")", "Tasks not marked done"],
    ["Team", "Calendar entries", rowsOf("Calendar"), "Practices, meetings and events"],
    ["Money", "Income (USD)", "=" + sumIf("Finance", "type", "income", "amount_usd"), "Income ledger rows with counts_in_balance TRUE, across seasons"],
    ["Money", "Expenses (USD)", "=" + sumIf("Finance", "type", "expense", "amount_usd"), "Expense ledger rows with counts_in_balance TRUE, across seasons"],
    ["Money", "Recorded balance (USD)", "=" + sumIf("Finance", "type", "income", "amount_usd") + "-" + sumIf("Finance", "type", "expense", "amount_usd"), "Included income minus included expenses; supporting records are in Finance"],
    ["Money", "Active sponsors", countOf("Sponsors", "status", "active"), "Sponsors with status active"],
    ["Competition", "Teams at the event", rowsOf("Teams"), "Teams at the active event"],
    ["Competition", "Matches", rowsOf("Matches"), "Matches at the active event"],
    ["Competition", "Match scouting entries", rowsOf("MatchScouting"), "Submitted reports; multiple scouts may report the same robot and match"],
    ["Competition", "Pit scouting entries", rowsOf("PitScouting"), "Submitted pit reports; multiple reports may describe one robot"],
    ["Robot", "Failures logged", rowsOf("RobotFailures"), "Every logged robot failure"],
    ["Robot", "Batteries in use", countOf("Batteries", "status", "active"), "Batteries with status active"],
  ];
  const rows = candidates.filter((row) => {
    if (String(row[2]).indexOf("tbl_Finance") >= 0 && !financeInclusionAvailable) return false;
    const dependencies = Array.from(String(row[2]).matchAll(/tbl_([A-Za-z0-9_]+)/g), (match) => match[1]);
    return dependencies.every((name) => Boolean(book.getSheetByName(name)));
  });
  // Older deployed clients can still refresh their readable records. Without
  // the inclusion column their totals are unavailable, rather than fabricated.
  if (financeSheet && !financeInclusionAvailable) rows.push(["Money", "Included ledger totals", "Unavailable", "This older copy lacks counts_in_balance. Refresh from the current Vantage version for included ledger totals."]);
  if (!rows.length) rows.push(["Workspace", "Table catalog", "", "See Tables and SyncInfo for this workspace's resources and freshness"]);
  const sheet = book.getSheetByName("Summary") || book.insertSheet("Summary", 1);
  sheet.clearContents();
  const header = [["area", "measure", "value", "how it is worked out"]];
  sheet.getRange(1, 1, 1, 4).setValues(header);
  sheet.getRange(2, 1, rows.length, 4).setValues(rows);
  sheet.getRange(1, 1, 1, 4).setFontWeight("bold").setFontColor("#FFFFFF").setBackground("#1F3A5F");
  sheet.getRange(2, 3, rows.length, 1).setNumberFormat("#,##0.##");
  rows.forEach((row, index) => {
    if (String(row[1]).indexOf("(USD)") >= 0) sheet.getRange(index + 2, 3, 1, 1).setNumberFormat("$#,##0.00");
  });
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 120);
  sheet.setColumnWidth(2, 200);
  sheet.setColumnWidth(3, 120);
  sheet.setColumnWidth(4, 320);
  sheet.setTabColor("#6B7280");
  SpreadsheetApp.flush();
  const values = sheet.getRange(2, 3, rows.length, 1).getDisplayValues();
  for (let index = 0; index < values.length; index++) {
    if (String(rows[index][2]).startsWith("=") && (!values[index][0] || String(values[index][0]).startsWith("#"))) {
      throw new Error("Summary formula verification failed: " + rows[index][1]);
    }
  }
}

// ---------------------------------------------------------------- team index
// One "VantageFRC - Team index" spreadsheet in the same folder lists every team: number, name,
// a link to its spreadsheet and when it last changed. When this script sits inside a
// spreadsheet, that spreadsheet becomes the index (so it is never left "Untitled").
const VANTAGE_INDEX_KEY = "VANTAGE_INDEX_BOOK";
const VANTAGE_INDEX_NAME = "VantageFRC - Team index";
const VANTAGE_INDEX_HEADERS = ["team_number", "team_name", "spreadsheet", "last_updated", "spreadsheet_id", "key"];

function vantageIndexBook_() {
  const lock = LockService.getScriptLock();
  const acquired = !lock.hasLock();
  if (acquired) lock.waitLock(30000);
  try {
  const props = PropertiesService.getScriptProperties();
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    if (props.getProperty(VANTAGE_INDEX_KEY) !== active.getId()) {
      if (active.getName() !== VANTAGE_INDEX_NAME) active.rename(VANTAGE_INDEX_NAME);
      try {
        DriveApp.getFileById(active.getId()).moveTo(vantageHubFolder_());
      } catch (moveError) {
        // It stays where it is; the index still works.
      }
      props.setProperty(VANTAGE_INDEX_KEY, active.getId());
    }
    return active;
  }
  const id = props.getProperty(VANTAGE_INDEX_KEY);
  if (id) {
    if (!DriveApp.getFileById(id).isTrashed()) return SpreadsheetApp.openById(id);
  }
  const book = vantageCreateSpreadsheet_(VANTAGE_INDEX_NAME);
  DriveApp.getFileById(book.getId()).moveTo(vantageHubFolder_());
  props.setProperty(VANTAGE_INDEX_KEY, book.getId());
  return book;
  } finally { if (acquired) lock.releaseLock(); }
}

function vantageIndexUpdate_(team, book, lastSyncAt) {
  if (team.testRun) return;
  const index = vantageIndexBook_();
  const sheet = index.getSheetByName("Teams") || index.insertSheet("Teams", 0);
  const width = VANTAGE_INDEX_HEADERS.length;
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, width).setValues([VANTAGE_INDEX_HEADERS]);
    sheet.getRange(1, 1, 1, width).setFontWeight("bold").setFontColor("#FFFFFF").setBackground("#1F3A5F");
    sheet.setFrozenRows(1);
  }
  const key = vantageTeamKey_(team);
  const last = sheet.getLastRow();
  const keys = last > 1 ? sheet.getRange(2, width, last - 1, 1).getValues().map((row) => String(row[0])) : [];
  const found = keys.indexOf(key);
  const row = found >= 0 ? found + 2 : last + 1;
  const kept = found >= 0 ? sheet.getRange(row, 4).getDisplayValue() : "";
  const number = String(team.number || "").replace(/[^0-9]/g, "").slice(0, 6);
  // Text first, so Sheets keeps the ISO time as written instead of turning it into a date.
  sheet.getRange(row, 4).setNumberFormat("@");
  sheet.getRange(row, 1, 1, width).setValues([[
    number ? Number(number) : "",
    String(team.name || "").replace(/\\s+/g, " ").trim().slice(0, 80),
    '=HYPERLINK("' + book.getUrl() + '","' + vantageTeamTitle_(team).replace(/"/g, "'") + '")',
    lastSyncAt || kept || "",
    book.getId(),
    key,
  ]]);
  if (sheet.getLastRow() > 2) sheet.getRange(2, 1, sheet.getLastRow() - 1, width).sort({ column: 1, ascending: true });
  sheet.autoResizeColumns(1, width);
  const blank = index.getSheetByName("Sheet1");
  if (blank && index.getSheets().length > 1 && blank.getLastRow() === 0) index.deleteSheet(blank);
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
  const mac = vantageHmacHex_(body);
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= mac.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

function vantageReply_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
`;
}
