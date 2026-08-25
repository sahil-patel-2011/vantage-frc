/**
 * Bridge from the shared DataTable's column defs to CSV columns, so every table
 * built on the primitive gets a correct export without restating its columns.
 *
 * Pure and React-free on purpose: `header` is typed as `unknown` here because a
 * DataTable header is a ReactNode. Only a string header is usable as a CSV
 * heading — anything else (a badge, an icon, a tooltip) falls back to the key,
 * which is stable and machine-friendly.
 */

import type { CsvCell, CsvColumn } from "./to-csv";

export type ExportableTableColumn<Row> = {
  key: string;
  /** ReactNode in practice. Used as the CSV header only when it is a plain string. */
  header?: unknown;
  /** Overrides the CSV heading when the on-screen header is not a plain string. */
  exportHeader?: string;
  /**
   * Raw value for the CSV. Required whenever the on-screen cell is rendered
   * (`render`), because a rendered cell is a React element, not data.
   */
  exportValue?: (row: Row) => CsvCell;
  /** One line for the export button's "what's in this file" tooltip. */
  exportHint?: string;
  /** Leave this column out of the CSV (action buttons, checkboxes, avatars). */
  exportSkip?: boolean;
};

/** Columns a CSV can actually carry: everything not explicitly skipped. */
export function csvColumnsFromTable<Row>(
  columns: readonly ExportableTableColumn<Row>[],
): CsvColumn<Row>[] {
  const out: CsvColumn<Row>[] = [];
  for (const column of columns) {
    if (column.exportSkip) continue;
    const header =
      column.exportHeader ?? (typeof column.header === "string" && column.header.trim() ? column.header : column.key);
    out.push({
      key: column.key,
      header,
      ...(column.exportValue ? { value: column.exportValue } : {}),
      ...(column.exportHint ? { hint: column.exportHint } : {}),
    });
  }
  return out;
}

/**
 * Whether an in-place export button should render at all.
 * Sensitive tables opt out entirely; an export with no columns is not an export.
 */
export function shouldOfferTableExport<Row>(
  columns: readonly ExportableTableColumn<Row>[],
  options: { exportable?: boolean; sensitive?: boolean } = {},
): boolean {
  if (options.exportable === false) return false;
  if (options.sensitive) return false;
  return csvColumnsFromTable(columns).length > 0;
}
