/**
 * The Google Sheets copy of the team's workbook: the same WorkbookTarget (write) and
 * WorkbookReader (import) interfaces the Excel copy implements, so the sync and import code
 * cannot tell them apart and both copies get byte-for-byte the same tables.
 *
 * Google Sheets has no "tables", so a Vantage table is its worksheet: row 1 is the header
 * (frozen and bold), rows 2+ are the body. Every sync rewrites each Vantage sheet wholesale,
 * which makes a sync idempotent and lets the next sync repair a half-written sheet.
 *
 * Quota (developers.google.com/workspace/sheets/api/limits): 60 reads and 60 writes per
 * minute per user, 300 each per project; normal use is free, and exceeding the quota is
 * slated to be billable. So the whole sync is batched: ensureTable/replaceRows only record
 * what to write, and flush() sends it —
 *
 *   open                  1 read   (sheet ids, titles, grid sizes)
 *   structure, if needed  1 write  (add missing sheets, grow grids too small for the data)
 *   clear                 1 write  (every Vantage sheet, one values:batchClear)
 *   write                 1 write  (every header and row, one values:batchUpdate; split
 *                                   only past MAX_CELLS_PER_WRITE cells)
 *
 * — 1 read and 2 writes on a normal sync, 3 on the first. An import is 2 reads (open + one
 * values:batchGet for every sheet it needs). Nowhere near either limit.
 */

import { IMPORT_TABLES, type WorkbookReader, type WorkbookTableRead, type WorkbookTableRef } from "../microsoft/workbook-import";
import type { CellValue, TableSpec } from "../microsoft/workbook-schema";
import type { WorkbookTarget } from "../microsoft/workbook-sync";
import { GoogleSheetsClient, GoogleSheetsError, SHEETS_API_BASE } from "./google-api";

/** One values:batchUpdate carries at most this many cells, keeping requests well under Google's payload limit. */
export const MAX_CELLS_PER_WRITE = 250_000;
const MAX_ROWS_READ = 20_000;
/** A new sheet has room to grow before the next sync has to resize it. */
const GRID_HEADROOM_ROWS = 200;

export type GoogleSpreadsheet = { spreadsheetId: string; url: string; name: string };

type SheetMeta = { sheetId: number; rows: number; columns: number };

/** A1 column letters: 1 → A, 27 → AA. */
export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out || "A";
}

/** A sheet name inside an A1 range: always quoted, with quotes doubled. */
export function quoteSheet(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function fitRow(row: CellValue[], width: number): CellValue[] {
  const out = row.slice(0, width).map((cell) => (cell === null ? "" : cell));
  while (out.length < width) out.push("");
  return out;
}

type ValueRange = { range: string; values: CellValue[][] };

/** A block of one table: rows `startRow`.. (1-based; row 1 is the header), `width` columns. */
export type TableChunk = { sheet: string; startRow: number; width: number; values: CellValue[][] };

/**
 * Header + rows for each table, cut into blocks and grouped so no request carries more than
 * `maxCells` cells. A table bigger than that is split by rows across requests. Pure; shared
 * by the Sheets API target and the Apps Script bridge.
 */
export function planTableChunks(
  tables: Array<{ spec: TableSpec; rows: CellValue[][] }>,
  maxCells = MAX_CELLS_PER_WRITE,
): TableChunk[][] {
  const requests: TableChunk[][] = [];
  let current: TableChunk[] = [];
  let cells = 0;
  const push = (item: TableChunk) => {
    const size = item.values.length * item.width;
    if (current.length && cells + size > maxCells) {
      requests.push(current);
      current = [];
      cells = 0;
    }
    current.push(item);
    cells += size;
  };
  for (const { spec, rows } of tables) {
    const width = Math.max(spec.columns.length, 1);
    const all: CellValue[][] = [spec.columns, ...rows.map((row) => fitRow(row, width))];
    const rowsPerChunk = Math.max(1, Math.floor(maxCells / width));
    for (let start = 0; start < all.length; start += rowsPerChunk) {
      push({ sheet: spec.sheet, startRow: start + 1, width, values: all.slice(start, start + rowsPerChunk) });
    }
  }
  if (current.length) requests.push(current);
  return requests;
}

/** The same blocks as A1 value ranges for values:batchUpdate. */
export function planValueWrites(
  tables: Array<{ spec: TableSpec; rows: CellValue[][] }>,
  maxCells = MAX_CELLS_PER_WRITE,
): ValueRange[][] {
  return planTableChunks(tables, maxCells).map((request) =>
    request.map((chunk) => ({
      range: `${quoteSheet(chunk.sheet)}!A${chunk.startRow}:${columnLetter(chunk.width)}${chunk.startRow + chunk.values.length - 1}`,
      values: chunk.values,
    })),
  );
}

export class GoogleSheetsTarget implements WorkbookTarget, WorkbookReader {
  private readonly sheets = new Map<string, SheetMeta>();
  private readonly pending = new Map<string, { spec: TableSpec; rows: CellValue[][] }>();
  private reads: Map<string, unknown[][]> | null = null;

  private constructor(
    private readonly client: GoogleSheetsClient,
    readonly spreadsheetId: string,
  ) {}

  private get base() {
    return `${SHEETS_API_BASE}/${encodeURIComponent(this.spreadsheetId)}`;
  }

  static async open(client: GoogleSheetsClient, spreadsheetId: string): Promise<GoogleSheetsTarget> {
    const target = new GoogleSheetsTarget(client, spreadsheetId);
    const meta = await client.request<{
      sheets?: Array<{
        properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number; columnCount?: number } };
      }>;
    }>("GET", `${target.base}?fields=sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))`);
    for (const sheet of meta?.sheets ?? []) {
      const { sheetId, title, gridProperties } = sheet.properties ?? {};
      if (typeof sheetId === "number" && typeof title === "string") {
        target.sheets.set(title, {
          sheetId,
          rows: gridProperties?.rowCount ?? 1000,
          columns: gridProperties?.columnCount ?? 26,
        });
      }
    }
    return target;
  }

  /** Recorded, not sent: flush() writes every table in a handful of requests. */
  async ensureTable(spec: TableSpec): Promise<void> {
    if (!this.pending.has(spec.sheet)) this.pending.set(spec.sheet, { spec, rows: [] });
  }

  async replaceRows(spec: TableSpec, rows: CellValue[][]): Promise<void> {
    this.pending.set(spec.sheet, { spec, rows });
  }

  async flush(): Promise<void> {
    const tables = [...this.pending.values()];
    if (!tables.length) return;

    // 1. Structure: add missing sheets and grow grids the data would overflow (writing
    //    past a sheet's grid is an error, and a new sheet starts at 1000 x 26).
    const structure: unknown[] = [];
    let nextId = Math.max(0, ...[...this.sheets.values()].map((sheet) => sheet.sheetId)) + 1;
    for (const { spec, rows } of tables) {
      const needRows = rows.length + 1;
      const needColumns = Math.max(spec.columns.length, 1);
      const existing = this.sheets.get(spec.sheet);
      if (!existing) {
        const sheetId = nextId++;
        const grid = { rowCount: needRows + GRID_HEADROOM_ROWS, columnCount: needColumns, frozenRowCount: 1 };
        structure.push(
          { addSheet: { properties: { sheetId, title: spec.sheet, gridProperties: grid } } },
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: "userEnteredFormat.textFormat.bold",
            },
          },
        );
        this.sheets.set(spec.sheet, { sheetId, rows: grid.rowCount, columns: grid.columnCount });
      } else if (existing.rows < needRows || existing.columns < needColumns) {
        const rowCount = Math.max(existing.rows, needRows + GRID_HEADROOM_ROWS);
        const columnCount = Math.max(existing.columns, needColumns);
        structure.push({
          updateSheetProperties: {
            properties: { sheetId: existing.sheetId, gridProperties: { rowCount, columnCount } },
            fields: "gridProperties.rowCount,gridProperties.columnCount",
          },
        });
        this.sheets.set(spec.sheet, { ...existing, rows: rowCount, columns: columnCount });
      }
    }
    if (structure.length) await this.client.request("POST", `${this.base}:batchUpdate`, { requests: structure });

    // 2. Clear every Vantage sheet in one request, then 3. write every header and row.
    await this.client.request("POST", `${this.base}/values:batchClear`, {
      ranges: tables.map(({ spec }) => quoteSheet(spec.sheet)),
    });
    for (const data of planValueWrites(tables)) {
      await this.client.request("POST", `${this.base}/values:batchUpdate`, { valueInputOption: "RAW", data });
    }
    this.pending.clear();
  }

  /** One values:batchGet for every table an import reads, on the first call. */
  async readTable(ref: WorkbookTableRef): Promise<WorkbookTableRead | null> {
    if (!this.sheets.has(ref.sheet)) return null;
    if (!this.reads) {
      const wanted = [...new Set([...IMPORT_TABLES.map((table) => table.sheet), ref.sheet])].filter((sheet) =>
        this.sheets.has(sheet),
      );
      const params = new URLSearchParams({ valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" });
      for (const sheet of wanted) params.append("ranges", `${quoteSheet(sheet)}!A1:ZZ${MAX_ROWS_READ + 1}`);
      const data = await this.client.request<{ valueRanges?: Array<{ values?: unknown[][] }> }>(
        "GET",
        `${this.base}/values:batchGet?${params.toString()}`,
      );
      this.reads = new Map(wanted.map((sheet, i) => [sheet, data?.valueRanges?.[i]?.values ?? []]));
    }
    const values = this.reads.get(ref.sheet) ?? [];
    const headers = values[0] ?? [];
    const width = headers.length;
    // Google trims trailing empty cells; pad rows back to the header width.
    const rows = values.slice(1).map((row) => {
      const out = row.slice(0, Math.max(width, row.length));
      while (out.length < width) out.push("");
      return out;
    });
    return { headers, rows, truncated: values.length > MAX_ROWS_READ + 1 };
  }

  async close(): Promise<void> {
    // Nothing held open: Sheets has no sessions.
  }
}

/** Create the team's spreadsheet (drive.file scope: Vantage can only edit files it created). */
export async function createSpreadsheet(client: GoogleSheetsClient, title: string): Promise<GoogleSpreadsheet> {
  const created = await client.request<{ spreadsheetId?: string; spreadsheetUrl?: string; properties?: { title?: string } }>(
    "POST",
    SHEETS_API_BASE,
    { properties: { title } },
  );
  if (!created?.spreadsheetId) {
    throw new GoogleSheetsError("unavailable", "Google did not return the new spreadsheet.", null, "no_spreadsheet_id");
  }
  return {
    spreadsheetId: created.spreadsheetId,
    url: created.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit`,
    name: created.properties?.title ?? title,
  };
}
