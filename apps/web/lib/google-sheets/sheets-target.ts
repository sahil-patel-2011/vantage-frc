/**
 * The Google Sheets copy of the team's workbook: the same WorkbookTarget (write) and
 * WorkbookReader (import) interfaces the Excel copy implements, so the sync and import code
 * cannot tell them apart and both copies get byte-for-byte the same tables.
 *
 * Google Sheets has no "tables", so a Vantage table is its worksheet: row 1 is the header
 * (frozen and bold), rows 2+ are the body. Writing replaces the body wholesale — clear, then
 * write — which makes a sync idempotent and lets the next sync repair a half-written sheet.
 *
 * Quota: Sheets allows a limited number of requests per minute per user, so everything is
 * batched — one metadata read on open, one header check per table, and body writes in
 * chunks of ROWS_PER_WRITE rows.
 */

import type { WorkbookReader, WorkbookTableRead, WorkbookTableRef } from "../microsoft/workbook-import";
import type { CellValue, TableSpec } from "../microsoft/workbook-schema";
import type { WorkbookTarget } from "../microsoft/workbook-sync";
import { GoogleSheetsClient, GoogleSheetsError, SHEETS_API_BASE } from "./google-api";

const ROWS_PER_WRITE = 2_000;
const MAX_ROWS_READ = 20_000;

export type GoogleSpreadsheet = { spreadsheetId: string; url: string; name: string };

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

export class GoogleSheetsTarget implements WorkbookTarget, WorkbookReader {
  /** Sheet title → numeric sheetId. */
  private readonly sheets = new Map<string, number>();

  private constructor(
    private readonly client: GoogleSheetsClient,
    readonly spreadsheetId: string,
  ) {}

  private get base() {
    return `${SHEETS_API_BASE}/${encodeURIComponent(this.spreadsheetId)}`;
  }

  static async open(client: GoogleSheetsClient, spreadsheetId: string): Promise<GoogleSheetsTarget> {
    const target = new GoogleSheetsTarget(client, spreadsheetId);
    const meta = await client.request<{ sheets?: Array<{ properties?: { sheetId?: number; title?: string } }> }>(
      "GET",
      `${target.base}?fields=sheets.properties(sheetId,title)`,
    );
    for (const sheet of meta?.sheets ?? []) {
      const { sheetId, title } = sheet.properties ?? {};
      if (typeof sheetId === "number" && typeof title === "string") target.sheets.set(title, sheetId);
    }
    return target;
  }

  private async addSheet(title: string, columns: number): Promise<void> {
    const reply = await this.client.request<{
      replies?: Array<{ addSheet?: { properties?: { sheetId?: number } } }>;
    }>("POST", `${this.base}:batchUpdate`, {
      requests: [
        {
          addSheet: {
            properties: {
              title,
              gridProperties: { frozenRowCount: 1, columnCount: Math.max(columns, 1) },
            },
          },
        },
      ],
    });
    const sheetId = reply?.replies?.[0]?.addSheet?.properties?.sheetId;
    if (typeof sheetId !== "number") {
      throw new GoogleSheetsError("unavailable", "Google did not return the new sheet.", null, "no_sheet_id");
    }
    this.sheets.set(title, sheetId);
  }

  private async writeHeader(spec: TableSpec): Promise<void> {
    const sheetId = this.sheets.get(spec.sheet)!;
    const last = columnLetter(spec.columns.length);
    await this.client.request("POST", `${this.base}/values:batchClear`, { ranges: [quoteSheet(spec.sheet)] });
    await this.client.request(
      "PUT",
      `${this.base}/values/${encodeURIComponent(`${quoteSheet(spec.sheet)}!A1:${last}1`)}?valueInputOption=RAW`,
      { values: [spec.columns] },
    );
    await this.client.request("POST", `${this.base}:batchUpdate`, {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat.bold",
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
      ],
    });
  }

  async ensureTable(spec: TableSpec): Promise<void> {
    if (!this.sheets.has(spec.sheet)) {
      await this.addSheet(spec.sheet, spec.columns.length);
      await this.writeHeader(spec);
      return;
    }
    const last = columnLetter(Math.max(spec.columns.length, 1) + 5);
    const header = await this.client.request<{ values?: unknown[][] }>(
      "GET",
      `${this.base}/values/${encodeURIComponent(`${quoteSheet(spec.sheet)}!A1:${last}1`)}`,
    );
    const current = (header?.values?.[0] ?? []).map((cell) => String(cell ?? ""));
    const same = current.length === spec.columns.length && current.every((name, i) => name === spec.columns[i]);
    // Columns changed (a new scouting field, a schema update): the sheet is Vantage-owned,
    // so it is rewritten rather than spliced.
    if (!same) await this.writeHeader(spec);
  }

  async replaceRows(spec: TableSpec, rows: CellValue[][]): Promise<void> {
    const width = spec.columns.length;
    const last = columnLetter(width);
    // Clear every body row, including columns past the header a coach may have typed in.
    await this.client.request("POST", `${this.base}/values:batchClear`, {
      ranges: [`${quoteSheet(spec.sheet)}!A2:ZZZ`],
    });
    for (let i = 0; i < rows.length; i += ROWS_PER_WRITE) {
      const chunk = rows.slice(i, i + ROWS_PER_WRITE).map((row) => fitRow(row, width));
      const first = i + 2;
      const range = `${quoteSheet(spec.sheet)}!A${first}:${last}${first + chunk.length - 1}`;
      await this.client.request("PUT", `${this.base}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
        values: chunk,
      });
    }
  }

  async readTable(ref: WorkbookTableRef): Promise<WorkbookTableRead | null> {
    if (!this.sheets.has(ref.sheet)) return null;
    const range = `${quoteSheet(ref.sheet)}!A1:ZZ${MAX_ROWS_READ + 1}`;
    const data = await this.client.request<{ values?: unknown[][] }>(
      "GET",
      `${this.base}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
    );
    const values = data?.values ?? [];
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
