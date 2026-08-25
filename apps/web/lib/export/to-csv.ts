/**
 * RFC 4180 CSV serialisation for in-place "Export CSV" buttons.
 *
 * Pure — no DOM, no I/O, no React. The client-side ExportButton and the
 * /api/export/table fallback both call this, so a table exported either way
 * produces byte-identical output.
 *
 * Rules this file exists to enforce (each one is a way spreadsheets get corrupted):
 *  - quotes are doubled and any field containing a comma / quote / CR / LF is quoted
 *  - records are separated by CRLF
 *  - an optional UTF-8 BOM so Excel opens accented names as UTF-8, not mojibake
 *  - null / undefined become an empty field (never the string "null")
 *  - Date becomes ISO-8601 (never a locale string)
 *  - numbers are written unformatted — no thousands separators, no locale decimal comma
 *  - a leading = + - @ (or tab / CR) in a *text* cell is prefixed with an apostrophe so
 *    the cell cannot execute as a formula when the file is opened in Excel / Sheets.
 *    Numeric cells are never prefixed, so -5 stays the number -5.
 */

export type CsvCell =
  | string
  | number
  | bigint
  | boolean
  | Date
  | null
  | undefined
  | readonly unknown[]
  | object;

export type CsvColumn<Row> = {
  /** Stable id. Also the default header and the property read off the row. */
  key: string;
  /** Heading written to row 1. Defaults to `key`. */
  header?: string;
  /**
   * Pulls the raw value for this row. Defaults to `row[key]`.
   * Return the *raw* value — never a locale-formatted or already-rounded string.
   */
  value?: (row: Row) => CsvCell;
  /** One short line for the "what's in this file" tooltip. */
  hint?: string;
};

export type ToCsvOptions = {
  /** Prepend a UTF-8 BOM so Excel detects UTF-8. Default true. */
  bom?: boolean;
  /** Apostrophe-prefix formula-looking text cells. Default true. Only turn off for machine pipelines. */
  formulaGuard?: boolean;
};

/** RFC 4180 record separator. */
export const CSV_EOL = "\r\n";

/** U+FEFF. Excel needs it to read UTF-8; most other tools strip it. */
export const CSV_BOM = "﻿";

const NEEDS_QUOTES = /[",\r\n]/;

/** OWASP CSV-injection lead characters, plus tab/CR which Excel also treats as a formula lead. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** Combining marks left behind by NFKD, stripped so filenames stay ASCII-safe. */
const COMBINING_MARKS = /[̀-ͯ]/g;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * Raw value -> the text that belongs in the field, before quoting.
 * Returns `{ text, numeric }` — numeric cells skip the formula guard so negatives survive.
 */
export function csvText(value: CsvCell): { text: string; numeric: boolean } {
  if (value === null || value === undefined) return { text: "", numeric: false };
  if (typeof value === "number") {
    // NaN / Infinity are not representable in a spreadsheet — an empty cell is honest.
    return Number.isFinite(value) ? { text: String(value), numeric: true } : { text: "", numeric: false };
  }
  if (typeof value === "bigint") return { text: value.toString(), numeric: true };
  if (typeof value === "boolean") return { text: value ? "true" : "false", numeric: false };
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? { text: "", numeric: false } : { text: value.toISOString(), numeric: false };
  }
  if (Array.isArray(value)) {
    // Tag/id lists read fine as a joined cell; nested objects inside are dropped, not stringified.
    const parts = value
      .map((entry) => (isPlainRecord(entry) ? "" : csvText(entry as CsvCell).text))
      .filter((part) => part !== "");
    return { text: parts.join("; "), numeric: false };
  }
  if (isPlainRecord(value)) {
    // React elements and row objects land here. Never dump "[object Object]" into a cell.
    return { text: "", numeric: false };
  }
  return { text: String(value), numeric: false };
}

/** Escape one already-stringified field per RFC 4180. */
export function quoteCsvField(text: string): string {
  if (!NEEDS_QUOTES.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Full single-cell pipeline: stringify -> formula guard -> quote. */
export function csvCell(value: CsvCell, formulaGuard = true): string {
  const { text, numeric } = csvText(value);
  const guarded = formulaGuard && !numeric && FORMULA_LEAD.test(text) ? `'${text}` : text;
  return quoteCsvField(guarded);
}

function readCell<Row>(column: CsvColumn<Row>, row: Row): CsvCell {
  if (column.value) return column.value(row);
  if (row === null || typeof row !== "object") return null;
  return (row as Record<string, unknown>)[column.key] as CsvCell;
}

/** Header text for a column, for both the file and the tooltip. */
export function csvHeaderText<Row>(column: CsvColumn<Row>): string {
  return column.header ?? column.key;
}

/**
 * Serialise rows to an RFC 4180 CSV string.
 * A header row is always written, so an empty table still exports a usable, self-describing file.
 */
export function toCsv<Row>(
  rows: readonly Row[],
  columns: readonly CsvColumn<Row>[],
  options: ToCsvOptions = {},
): string {
  const formulaGuard = options.formulaGuard !== false;
  const lines: string[] = [];
  lines.push(columns.map((column) => csvCell(csvHeaderText(column), formulaGuard)).join(","));
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(readCell(column, row), formulaGuard)).join(","));
  }
  const body = lines.map((line) => `${line}${CSV_EOL}`).join("");
  return `${options.bom === false ? "" : CSV_BOM}${body}`;
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Local calendar date — a team exporting at 8pm should get today's date, not tomorrow's UTC. */
function localYmd(at: Date): string {
  const month = `${at.getMonth() + 1}`.padStart(2, "0");
  const day = `${at.getDate()}`.padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/**
 * `feature-org-YYYY-MM-DD.csv` — sortable in a Downloads folder and obvious in a
 * shared Drive when three teams' files sit side by side.
 */
export function csvFileName(feature: string, orgLabel?: string | null, at: Date = new Date()): string {
  const parts = [slug(feature) || "export", orgLabel ? slug(orgLabel) : "", localYmd(at)].filter(Boolean);
  return `${parts.join("-")}.csv`;
}

/** "Header — hint" lines for the export button's "what's in this file" tooltip. */
export function describeCsvColumns<Row>(columns: readonly CsvColumn<Row>[]): string[] {
  return columns.map((column) => {
    const header = csvHeaderText(column);
    return column.hint ? `${header} — ${column.hint}` : header;
  });
}
