/**
 * The Microsoft Graph implementation of `WorkbookTarget`, plus the two OneDrive calls the
 * connect flow needs (who is this account, and find-or-create the workbook).
 *
 * Every endpoint below was checked against the v1.0 reference on learn.microsoft.com:
 *
 *   createSession   POST /me/drive/items/{id}/workbook/createSession {"persistChanges":true}
 *                   → 201 {id}; later calls send `workbook-session-id: {id}`.
 *                   https://learn.microsoft.com/en-us/graph/api/workbook-createsession
 *                   NOTE: that page lists createSession as "Not supported" for personal
 *                   Microsoft accounts, and says the session header "is not required for an
 *                   Excel API to work … changes made during the API call are persisted".
 *                   So when createSession fails we continue sessionless (persisted writes).
 *   closeSession    POST /me/drive/items/{id}/workbook/closeSession (header) → 204
 *                   https://learn.microsoft.com/en-us/graph/workbook-best-practice
 *   list sheets     GET  …/workbook/worksheets          (workbookWorksheet collection)
 *   add sheet       POST …/workbook/worksheets/add {"name"} → 201
 *                   https://learn.microsoft.com/en-us/graph/api/worksheetcollection-add
 *   delete sheet    DELETE …/workbook/worksheets/{name} → 204
 *                   https://learn.microsoft.com/en-us/graph/api/worksheet-delete
 *   list tables     GET  …/workbook/tables              (workbookTable: id, name)
 *                   https://learn.microsoft.com/en-us/graph/api/resources/workbooktable
 *   add table       POST …/workbook/worksheets/{name}/tables/add {"address","hasHeaders"} → 200 {id,name}
 *                   https://learn.microsoft.com/en-us/graph/api/tablecollection-add
 *   rename table    PATCH …/workbook/tables/{id} {"name"} → 200
 *                   https://learn.microsoft.com/en-us/graph/api/table-update
 *   header row      GET  …/workbook/tables/{name}/headerRowRange  (workbookRange.values)
 *   data body       GET  …/workbook/tables/{name}/dataBodyRange   (address, rowCount)
 *                   https://learn.microsoft.com/en-us/graph/api/table-databodyrange
 *   delete cells    POST …/workbook/worksheets/{name}/range(address='A3:F40')/delete {"shift":"Up"} → 204
 *                   https://learn.microsoft.com/en-us/graph/api/range-delete
 *   write cells     PATCH …/workbook/worksheets/{name}/range(address='A2:F2') {"values":[[…]]} → 200
 *                   (`null` in values means "ignore this cell", so blanks are sent as "")
 *                   https://learn.microsoft.com/en-us/graph/api/range-update
 *   append rows     POST …/workbook/tables/{name}/rows/add {"values":[[…],[…]]} → 200
 *                   "batch the rows together in a single call rather than doing single row insertion"
 *                   https://learn.microsoft.com/en-us/graph/api/tablerowcollection-add
 *   read header     GET  …/workbook/tables/{name}/headerRowRange?$select=values   (import)
 *                   https://learn.microsoft.com/en-us/graph/api/table-headerrowrange
 *   read body       GET  …/workbook/tables/{name}/dataBodyRange?$select=address,rowCount, then
 *                   GET  …/workbook/worksheets/{name}/range(address='A2:S2001')?$select=values
 *                   in chunks of READ_ROWS_PER_REQUEST rows (import). `values` are the cells'
 *                   computed values: numbers stay numbers, a formula returns its result, and
 *                   an empty cell is "".  https://learn.microsoft.com/en-us/graph/api/worksheet-range
 *                   https://learn.microsoft.com/en-us/graph/api/resources/workbookrange
 *   who am I        GET  /me?$select=displayName,mail,userPrincipalName
 *                   https://learn.microsoft.com/en-us/graph/api/user-get
 *   find file       GET  /me/drive/root:/{path}   (404 when absent)
 *   create folder   POST /me/drive/root/children {"name","folder":{},"@microsoft.graph.conflictBehavior":"fail"} → 201
 *                   https://learn.microsoft.com/en-us/graph/api/driveitem-post-children
 *   upload file     PUT  /me/drive/root:/{path}:/content (≤ 250 MB) → 201 driveItem {id, webUrl}
 *                   https://learn.microsoft.com/en-us/graph/api/driveitem-put-content
 *
 * All writes to one workbook are sequential — Microsoft's Excel guidance: "for each
 * workbook, only send the next request after receiving a successful response".
 */

import { GraphClient, GraphError, isGraphError } from "./graph";
import { XLSX_CONTENT_TYPE, minimalXlsx } from "./minimal-xlsx";
import { type CellValue, type TableSpec, columnLetter } from "./workbook-schema";
import type { WorkbookReader, WorkbookTableRead, WorkbookTableRef } from "./workbook-import";
import type { WorkbookTarget } from "./workbook-sync";

/** rows/add payload size. Microsoft gives no hard cap; 500 keeps each request small. */
export const ROWS_PER_REQUEST = 500;

/** Rows per range GET when reading a table back (import): keeps each response small. */
export const READ_ROWS_PER_REQUEST = 2000;

/** An import never reads more than this many rows of one table (the export caps at 20,000). */
export const MAX_ROWS_READ = 25_000;

const enc = encodeURIComponent;

/** "Teams!A2:F40" or "'My Sheet'!A2:F40" → rows/cols. */
export function parseRangeAddress(address: string): { firstRow: number; lastRow: number; firstCol: string; lastCol: string } | null {
  const local = address.includes("!") ? address.slice(address.lastIndexOf("!") + 1) : address;
  const match = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(local.trim());
  if (!match) return null;
  const firstCol = match[1]!;
  const firstRow = Number(match[2]);
  return {
    firstCol,
    firstRow,
    lastCol: match[3] ?? firstCol,
    lastRow: match[4] ? Number(match[4]) : firstRow,
  };
}

/** "PickList!A2:S40" → "PickList"; "'Pick ''24'''!A2" → "Pick '24'"; no sheet part → null. */
export function sheetFromAddress(address: string): string | null {
  const bang = address.lastIndexOf("!");
  if (bang <= 0) return null;
  const sheet = address.slice(0, bang);
  return sheet.startsWith("'") && sheet.endsWith("'") ? sheet.slice(1, -1).replace(/''/g, "'") : sheet;
}

function blankRow(width: number): CellValue[] {
  return Array.from({ length: width }, () => "");
}

/** Normalise a row to exactly `width` cells, with "" for blanks (never null). */
function fitRow(row: CellValue[], width: number): CellValue[] {
  const out = row.slice(0, width).map((cell) => (cell === null ? "" : cell));
  while (out.length < width) out.push("");
  return out;
}

export class GraphWorkbookTarget implements WorkbookTarget, WorkbookReader {
  private readonly sheets = new Set<string>();
  private readonly tables = new Set<string>();
  private readonly base: string;

  private constructor(
    private readonly graph: GraphClient,
    itemId: string,
  ) {
    this.base = `/me/drive/items/${enc(itemId)}/workbook`;
  }

  /**
   * Open the workbook: one session (when the account supports it) and one read each of sheets
   * and tables. An import opens it with `persistChanges: false`: it only reads.
   */
  static async open(
    graph: GraphClient,
    itemId: string,
    options: { persistChanges?: boolean } = {},
  ): Promise<GraphWorkbookTarget> {
    const target = new GraphWorkbookTarget(graph, itemId);
    try {
      const session = await graph.request<{ id?: string }>("POST", `${target.base}/createSession`, {
        body: { persistChanges: options.persistChanges ?? true },
      });
      if (session?.id) graph.sessionId = session.id;
    } catch (error) {
      // Personal accounts: sessions are documented as unsupported. Sessionless calls persist.
      // Anything that means "this workbook is unreachable" still stops the sync here.
      if (isGraphError(error) && (error.kind === "auth_expired" || error.kind === "not_found")) throw error;
      graph.sessionId = null;
    }
    const [sheets, tables] = [
      await graph.request<{ value?: Array<{ name?: string }> }>("GET", `${target.base}/worksheets?$select=name`),
      await graph.request<{ value?: Array<{ name?: string }> }>("GET", `${target.base}/tables?$select=name`),
    ];
    for (const sheet of sheets?.value ?? []) if (sheet.name) target.sheets.add(sheet.name);
    for (const table of tables?.value ?? []) if (table.name) target.tables.add(table.name);
    return target;
  }

  private sheetPath(sheet: string) {
    return `${this.base}/worksheets/${enc(sheet)}`;
  }

  private rangePath(sheet: string, address: string) {
    return `${this.sheetPath(sheet)}/range(address='${enc(address)}')`;
  }

  private async addSheet(sheet: string) {
    await this.graph.request("POST", `${this.base}/worksheets/add`, { body: { name: sheet } });
    this.sheets.add(sheet);
  }

  private async createTable(spec: TableSpec) {
    const last = columnLetter(spec.columns.length);
    await this.graph.request("PATCH", this.rangePath(spec.sheet, `A1:${last}1`), { body: { values: [spec.columns] } });
    const created = await this.graph.request<{ id?: string; name?: string }>(
      "POST",
      `${this.sheetPath(spec.sheet)}/tables/add`,
      { body: { address: `${spec.sheet}!A1:${last}1`, hasHeaders: true } },
    );
    if (!created?.id) throw new GraphError("unavailable", "Excel did not return the new table.", null, "no_table_id");
    if (created.name !== spec.table) {
      await this.graph.request("PATCH", `${this.base}/tables/${enc(created.id)}`, { body: { name: spec.table } });
    }
    this.tables.add(spec.table);
  }

  async ensureTable(spec: TableSpec): Promise<void> {
    if (this.tables.has(spec.table)) {
      const header = await this.graph.request<{ values?: unknown[][] }>(
        "GET",
        `${this.base}/tables/${enc(spec.table)}/headerRowRange?$select=values`,
      );
      const current = (header?.values?.[0] ?? []).map((cell) => String(cell ?? ""));
      if (current.length === spec.columns.length && current.every((name, i) => name === spec.columns[i])) return;
      // The columns changed (a new scouting field, a schema update). The sheet is Vantage-owned:
      // rebuild it rather than splice columns into a table someone may have re-sorted.
      await this.graph.request("DELETE", this.sheetPath(spec.sheet));
      this.sheets.delete(spec.sheet);
      this.tables.delete(spec.table);
      await this.addSheet(spec.sheet);
      await this.createTable(spec);
      return;
    }
    if (!this.sheets.has(spec.sheet)) await this.addSheet(spec.sheet);
    await this.createTable(spec);
  }

  /**
   * Replace the table body with `rows`, deterministically:
   *   1. delete every body row after the first (range delete, shift Up);
   *   2. overwrite the first body row (first data row, or blanks when there is no data);
   *   3. append the rest with rows/add in chunks of ROWS_PER_REQUEST.
   * Keeping one row means we never depend on how Excel treats a table with zero data rows,
   * so the same input always produces the same sheet.
   */
  async replaceRows(spec: TableSpec, rows: CellValue[][]): Promise<void> {
    const width = spec.columns.length;
    const last = columnLetter(width);
    const body = await this.graph.request<{ address?: string; rowCount?: number }>(
      "GET",
      `${this.base}/tables/${enc(spec.table)}/dataBodyRange?$select=address,rowCount`,
    );
    const parsed = body?.address ? parseRangeAddress(body.address) : null;
    const firstRow = parsed?.firstRow ?? 2;
    const lastRow = parsed?.lastRow ?? firstRow;
    if (lastRow > firstRow) {
      await this.graph.request("POST", `${this.rangePath(spec.sheet, `A${firstRow + 1}:${last}${lastRow}`)}/delete`, {
        body: { shift: "Up" },
      });
    }
    const first = rows[0] ? fitRow(rows[0], width) : blankRow(width);
    await this.graph.request("PATCH", this.rangePath(spec.sheet, `A${firstRow}:${last}${firstRow}`), {
      body: { values: [first] },
    });
    for (let i = 1; i < rows.length; i += ROWS_PER_REQUEST) {
      const chunk = rows.slice(i, i + ROWS_PER_REQUEST).map((row) => fitRow(row, width));
      await this.graph.request("POST", `${this.base}/tables/${enc(spec.table)}/rows/add`, { body: { values: chunk } });
    }
  }

  /**
   * Read a table back: its header names and every body row's values (import). Returns null
   * when the workbook has no such table. Uses the table's own ranges, so a table a coach
   * moved or widened is still read correctly; extra columns come back as extra headers.
   */
  async readTable(ref: WorkbookTableRef): Promise<WorkbookTableRead | null> {
    if (!this.tables.has(ref.table)) return null;
    const header = await this.graph.request<{ values?: unknown[][] }>(
      "GET",
      `${this.base}/tables/${enc(ref.table)}/headerRowRange?$select=values`,
    );
    const headers = header?.values?.[0] ?? [];
    const body = await this.graph.request<{ address?: string; rowCount?: number }>(
      "GET",
      `${this.base}/tables/${enc(ref.table)}/dataBodyRange?$select=address,rowCount`,
    );
    const parsed = body?.address ? parseRangeAddress(body.address) : null;
    if (!parsed) return { headers, rows: [] };
    const sheet = (body?.address ? sheetFromAddress(body.address) : null) ?? ref.sheet;
    const lastRow = Math.min(parsed.lastRow, parsed.firstRow + MAX_ROWS_READ - 1);
    const rows: unknown[][] = [];
    for (let first = parsed.firstRow; first <= lastRow; first += READ_ROWS_PER_REQUEST) {
      const last = Math.min(lastRow, first + READ_ROWS_PER_REQUEST - 1);
      const chunk = await this.graph.request<{ values?: unknown[][] }>(
        "GET",
        `${this.rangePath(sheet, `${parsed.firstCol}${first}:${parsed.lastCol}${last}`)}?$select=values`,
      );
      rows.push(...(chunk?.values ?? []));
    }
    return { headers, rows, truncated: lastRow < parsed.lastRow };
  }

  async close(): Promise<void> {
    if (!this.graph.sessionId) return;
    try {
      await this.graph.request("POST", `${this.base}/closeSession`, { body: {} });
    } catch {
      // A session that is not closed expires on its own; never fail a sync over it.
    } finally {
      this.graph.sessionId = null;
    }
  }
}

// ------------------------------------------------------------------ account + file

export type MicrosoftAccount = { displayName: string | null; email: string | null };

export async function readMicrosoftAccount(graph: GraphClient): Promise<MicrosoftAccount> {
  const me = await graph.request<{ displayName?: string; mail?: string | null; userPrincipalName?: string }>(
    "GET",
    "/me?$select=displayName,mail,userPrincipalName",
  );
  return {
    displayName: me?.displayName?.slice(0, 200) ?? null,
    email: (me?.mail || me?.userPrincipalName || null)?.slice(0, 320) ?? null,
  };
}

export const WORKBOOK_FOLDER = "Vantage";

/** OneDrive forbids " * : < > ? / \ | and trailing dots/spaces in names. */
export function workbookFileName(input: { teamNumber: number | null; orgName: string }): string {
  const label = input.teamNumber ? `Team ${input.teamNumber}` : input.orgName;
  const clean = label.replace(/["*:<>?/\\|#%]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 80);
  return `Vantage – ${clean || "Team"}.xlsx`;
}

export type WorkbookFile = { itemId: string; webUrl: string | null; name: string };

/**
 * Find the team's workbook at /Vantage/<name> in the connected OneDrive, or create it.
 * Reconnecting the same account therefore reuses the same file (and its history) rather
 * than scattering copies.
 */
export async function ensureWorkbookFile(graph: GraphClient, fileName: string): Promise<WorkbookFile> {
  const path = `/me/drive/root:/${enc(WORKBOOK_FOLDER)}/${enc(fileName)}`;
  try {
    const existing = await graph.request<{ id?: string; webUrl?: string; name?: string; file?: unknown }>(
      "GET",
      `${path}?$select=id,name,webUrl,file`,
    );
    if (existing?.id && existing.file) {
      return { itemId: existing.id, webUrl: existing.webUrl ?? null, name: existing.name ?? fileName };
    }
    if (existing?.id) {
      throw new GraphError("conflict", `"${WORKBOOK_FOLDER}/${fileName}" exists in OneDrive but is not a file.`, 409, "not_a_file");
    }
  } catch (error) {
    if (!isGraphError(error) || error.kind !== "not_found") throw error;
  }

  try {
    await graph.request("POST", "/me/drive/root/children", {
      body: { name: WORKBOOK_FOLDER, folder: {}, "@microsoft.graph.conflictBehavior": "fail" },
    });
  } catch (error) {
    // 409 = the folder is already there, which is what we wanted.
    if (!isGraphError(error) || error.kind !== "conflict") throw error;
  }

  const created = await graph.request<{ id?: string; webUrl?: string; name?: string }>("PUT", `${path}:/content`, {
    raw: minimalXlsx(),
    contentType: XLSX_CONTENT_TYPE,
  });
  if (!created?.id) throw new GraphError("unavailable", "OneDrive did not return the new workbook.", null, "no_item_id");
  return { itemId: created.id, webUrl: created.webUrl ?? null, name: created.name ?? fileName };
}

