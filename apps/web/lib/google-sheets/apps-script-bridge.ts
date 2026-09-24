/**
 * The Google Sheets copy through the team's own Apps Script web app — Google Sheets with no
 * Google Cloud project. Server side; the script itself is apps-script-source.ts.
 *
 * Stored in org_google_sheets_connections like an OAuth connection, so the mirror, its
 * status, locking and history treat it as the same "Google Sheets" copy:
 *   spreadsheet_id           "apps-script:<web app URL>"  (tells the two modes apart)
 *   refresh_token_* columns  the script's shared secret, envelope-encrypted like a token
 *   spreadsheet_url / name   what the script reported on the connect ping
 *
 * Requests: one "write" per sync (split only past MAX_CELLS_PER_SCRIPT_CALL cells), one
 * "read" per import. Apps Script runs under the owner's account with no Sheets API quota to
 * spend; its own limits (30 simultaneous runs, 6 minutes per run) are far above one team's
 * sync. A redirect is only followed to Google's own script.googleusercontent.com.
 */

import { createHmac } from "node:crypto";
import { IMPORT_TABLES, type WorkbookReader, type WorkbookTableRead, type WorkbookTableRef } from "../microsoft/workbook-import";
import type { CellValue, TableSpec } from "../microsoft/workbook-schema";
import type { WorkbookTarget } from "../microsoft/workbook-sync";
import { APPS_SCRIPT_MIN_VERSION, isAppsScriptSecret, isAppsScriptUrl } from "./apps-script-source";
import { GoogleSheetsError } from "./google-api";
import { planTableChunks } from "./sheets-target";

/**
 * JSON with every non-ASCII character written as \uXXXX. The script signs what Apps Script
 * decoded from the request, and its charset handling for text bodies is not guaranteed to
 * be UTF-8; an all-ASCII body reads back byte-for-byte, and JSON.parse restores the text.
 */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export const APPS_SCRIPT_PREFIX = "apps-script:";
export const MAX_CELLS_PER_SCRIPT_CALL = 200_000;
const ECHO_HOST = "script.googleusercontent.com";

/** The web app URL when this connection is an Apps Script bridge, else null. */
export function bridgeUrlOf(spreadsheetId: string | null | undefined): string | null {
  if (!spreadsheetId?.startsWith(APPS_SCRIPT_PREFIX)) return null;
  const url = spreadsheetId.slice(APPS_SCRIPT_PREFIX.length);
  return isAppsScriptUrl(url) ? url : null;
}

export function bridgeSpreadsheetId(url: string): string {
  return `${APPS_SCRIPT_PREFIX}${url.trim()}`;
}

const bridgeError = (
  kind: GoogleSheetsError["kind"],
  publicMessage: string,
  code: string,
  status: number | null = null,
) => new GoogleSheetsError(kind, publicMessage, status, code, null, publicMessage);

export type BridgeOptions = { fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number };

export class AppsScriptBridge {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(
    readonly url: string,
    private readonly secret: string,
    options: BridgeOptions = {},
  ) {
    if (!isAppsScriptUrl(url)) throw bridgeError("bad_request", "That is not an Apps Script web app address.", "bad_url");
    if (!isAppsScriptSecret(secret)) throw bridgeError("bad_request", "The Apps Script secret is malformed.", "bad_secret");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 90_000;
  }

  /** Signed POST; follows Google's one redirect to the script's output. */
  async call<T extends { ok: boolean; error?: string }>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    const body = asciiJson({ action, ts: this.now(), ...payload });
    const sig = createHmac("sha256", this.secret).update(body).digest("hex");
    let response = await this.send(`${this.url}?sig=${sig}`, { method: "POST", body, headers: { "content-type": "text/plain;charset=utf-8" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") ?? "";
      let host = "";
      try {
        host = new URL(location).hostname;
      } catch {
        // fall through to the refusal below
      }
      if (host !== ECHO_HOST) {
        throw bridgeError("forbidden", "The Apps Script answered from an unexpected address. Redeploy it and reconnect.", "bad_redirect", response.status);
      }
      response = await this.send(location, { method: "GET" });
    }
    if (response.status === 404) {
      throw bridgeError("not_found", "We couldn't reach that address. Check it's deployed as a Web app with access set to Anyone, then paste the /exec address again.", "not_found", 404);
    }
    if (response.status === 429) {
      throw bridgeError("throttled", "Google asked the Apps Script to slow down. The Excel copy keeps working; Google catches up on the next sync.", "throttled", 429);
    }
    if (response.status >= 500) {
      throw bridgeError("unavailable", "Google's Apps Script service did not answer. Try again in a few minutes.", "unavailable", response.status);
    }
    const text = await response.text();
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      // An HTML page: almost always the deployment is not open to "Anyone", so Google
      // answered with its sign-in page instead of running the script.
      throw bridgeError(
        "forbidden",
        'Google showed a sign-in page instead of running the script. In Apps Script, set the deployment\'s "Who has access" to "Anyone", deploy again, and reconnect.',
        "not_public",
        response.status,
      );
    }
    if (!data || data.ok !== true) {
      const error = String(data?.error ?? "unknown");
      if (error === "signature") {
        throw bridgeError("auth_expired", "Your Google Sheet's script has a different secret from the one Vantage saved. Press Disconnect, then connect again and paste the secret from the VANTAGE_SECRET line of your script.", "signature");
      }
      if (error === "stale") {
        throw bridgeError("unavailable", "The Apps Script refused the request as out of date. Try again.", "stale");
      }
      if (/too many|simultaneous|rate/i.test(error)) {
        throw bridgeError("throttled", "Google asked the Apps Script to slow down. The Excel copy keeps working; Google catches up on the next sync.", "script_throttled");
      }
      throw bridgeError("bad_request", `The Apps Script reported a problem: ${error.slice(0, 200)}`, "script_error");
    }
    return data;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, redirect: "manual", signal: controller.signal });
    } catch {
      throw bridgeError(
        "unavailable",
        controller.signal.aborted ? "The Apps Script took too long to answer. Try again." : "Could not reach Google's Apps Script service.",
        controller.signal.aborted ? "timeout" : "network",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** `hub` asks the script to answer as the team-sheets hub even when it sits inside a spreadsheet. */
  async ping(options: { hub?: boolean } = {}): Promise<{ version: number; name: string | null; url: string | null; hub: boolean }> {
    const data = await this.call<{ ok: boolean; version?: number; name?: string; url?: string; hub?: boolean }>(
      "ping",
      options.hub ? { hub: true } : undefined,
    );
    if (!(Number(data.version) >= APPS_SCRIPT_MIN_VERSION)) {
      throw bridgeError("bad_request", "This Apps Script is an older version. Copy the script from Connectors again and redeploy.", "old_version");
    }
    return { version: Number(data.version), name: data.name ?? null, url: data.url ?? null, hub: data.hub === true };
  }

  /** Hub mode: find or make this team's spreadsheet in the VantageFRC folder. */
  async ensureTeamBook(team: HubTeam): Promise<HubTeamBook> {
    const data = await this.call<{
      ok: boolean;
      id?: string;
      url?: string;
      name?: string;
      created?: boolean;
      lastHash?: string | null;
      lastSyncAt?: string | null;
    }>("team.ensure", { team });
    const url = typeof data.url === "string" && /^https:\/\/docs\.google\.com\/spreadsheets\//.test(data.url) ? data.url : null;
    return {
      id: String(data.id ?? ""),
      url,
      name: data.name ?? null,
      created: data.created === true,
      lastHash: data.lastHash ?? null,
      lastSyncAt: data.lastSyncAt ?? null,
    };
  }

  /**
   * Hub mode: remember what was written, so the next sync can skip an unchanged team. `order`
   * is the tables in write order; version 4 scripts then lay every tab out as a table.
   */
  async stampTeamBook(team: HubTeam, hash: string, order: string[] = []): Promise<void> {
    await this.call("team.stamp", { team, hash, order });
  }
}

/** One team's spreadsheet in hub mode. `key` is the team's id; viewers get read access. */
export type HubTeam = { key: string; number: number | null; name: string; title?: string; viewers?: string[] };

export type HubTeamBook = {
  id: string;
  url: string | null;
  name: string | null;
  created: boolean;
  lastHash: string | null;
  lastSyncAt: string | null;
};

/** WorkbookTarget/Reader over the bridge — batched exactly like the Sheets API target. */
export class AppsScriptTarget implements WorkbookTarget, WorkbookReader {
  private readonly pending = new Map<string, { spec: TableSpec; rows: CellValue[][] }>();
  private reads: Record<string, unknown[][] | null> | null = null;

  /** `team` switches the script to hub mode: every call works on that team's spreadsheet. */
  constructor(
    private readonly bridge: AppsScriptBridge,
    private readonly team: HubTeam | null = null,
  ) {}

  private scope(): Record<string, unknown> {
    return this.team ? { team: this.team } : {};
  }

  async ensureTable(spec: TableSpec): Promise<void> {
    if (!this.pending.has(spec.sheet)) this.pending.set(spec.sheet, { spec, rows: [] });
  }

  async replaceRows(spec: TableSpec, rows: CellValue[][]): Promise<void> {
    this.pending.set(spec.sheet, { spec, rows });
  }

  async flush(): Promise<void> {
    const tables = [...this.pending.values()];
    if (!tables.length) return;
    for (const request of planTableChunks(tables, MAX_CELLS_PER_SCRIPT_CALL)) {
      await this.bridge.call("write", {
        ...this.scope(),
        // The first block of a table clears the sheet; later blocks append below it.
        items: request.map((chunk) => ({ ...chunk, clear: chunk.startRow === 1 })),
      });
    }
    this.pending.clear();
  }

  async readTable(ref: WorkbookTableRef): Promise<WorkbookTableRead | null> {
    if (!this.reads) {
      const sheets = [...new Set([...IMPORT_TABLES.map((table) => table.sheet), ref.sheet])];
      const data = await this.bridge.call<{ ok: boolean; values?: Record<string, unknown[][] | null> }>("read", { ...this.scope(), sheets });
      this.reads = data.values ?? {};
    }
    const values = this.reads[ref.sheet];
    if (!values) return null;
    const headers = values[0] ?? [];
    return { headers, rows: values.slice(1), truncated: false };
  }

  async close(): Promise<void> {
    // Nothing held open.
  }
}
