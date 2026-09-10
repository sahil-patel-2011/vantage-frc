"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { csvColumnsFromTable, shouldOfferTableExport } from "../../lib/export/table-columns";
import type { CsvCell } from "../../lib/export/to-csv";
import { ExportButton } from "./export-button";
import { TableSkeleton } from "./skeleton";
import styles from "./ui.module.css";

export type Column<Row> = {
  key: string;
  header: ReactNode;
  render?: (r: Row) => ReactNode;
  align?: "start" | "end";
  /** Sticky first column (identifying field — part name / team number). */
  sticky?: boolean;
  numeric?: boolean;
  /**
   * CSV heading, when the on-screen `header` is not a plain string.
   * Without it a non-string header falls back to `key`.
   */
  exportHeader?: string;
  /**
   * Raw value for the CSV. REQUIRED whenever `render` is set — a rendered cell is a
   * React element, not data, and the export must never stringify one.
   */
  exportValue?: (r: Row) => CsvCell;
  /** One line describing the column in the export button's tooltip. */
  exportHint?: string;
  /** Keep this column out of the CSV (action buttons, checkboxes, avatars). */
  exportSkip?: boolean;
};

type DataTableProps<Row> = {
  columns: Column<Row>[];
  rows: Row[];
  getRowId: (r: Row) => string;
  /** px width below which the table collapses to a card-per-row. Default 560. */
  stackBelow?: number;
  /** Row checkboxes + shift-click range selection (bulk ops). */
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  emptyState?: ReactNode;
  loading?: boolean;
  className?: string;
  "aria-label"?: string;
  /**
   * In-place CSV export of exactly the rows passed in. On by default — teams'
   * analysis lives in Sheets/Tableau, and a table without export gets re-typed by hand.
   */
  exportable?: boolean;
  /**
   * Opt-out for tables holding sensitive data (minors' contact details, medical or
   * consent records, keys, audit trails). Suppresses the button entirely.
   */
  sensitive?: boolean;
  /** Name of this table in the filename and tooltip. Defaults to `aria-label`. */
  exportFeature?: string;
  /** Team number / workspace name folded into the filename. */
  exportOrgLabel?: string | null;
  /** Deep-links the tooltip's "full export" line to this team's Export Center. */
  exportOrgId?: string | null;
  /** One line naming where these rows came from, shown in the tooltip. */
  exportProvenance?: string;
};

function cellContent<Row>(col: Column<Row>, row: Row): ReactNode {
  return col.render ? col.render(row) : ((row as Record<string, unknown>)[col.key] as ReactNode);
}

/**
 * Responsive table. Scroll-x + sticky first column for compare/edit grids; collapses to a
 * card-per-row below `stackBelow` (read-heavy dense rows). Optional bulk-select with shift-range.
 */
export function DataTable<Row>({
  columns,
  rows,
  getRowId,
  stackBelow = 560,
  selectable = false,
  selectedIds,
  onSelectionChange,
  emptyState,
  loading = false,
  className,
  "aria-label": ariaLabel,
  exportable = true,
  sensitive = false,
  exportFeature,
  exportOrgLabel,
  exportOrgId,
  exportProvenance,
}: DataTableProps<Row>) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [stacked, setStacked] = useState(false);
  const lastIndex = useRef<number | null>(null);

  // Uncontrolled selection fallback.
  const [internalSel, setInternalSel] = useState<string[]>([]);
  const selected = selectedIds ?? internalSel;
  const setSelected = useCallback(
    (ids: string[]) => {
      if (onSelectionChange) onSelectionChange(ids);
      if (selectedIds == null) setInternalSel(ids);
    },
    [onSelectionChange, selectedIds],
  );

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const measure = () => setStacked(el.offsetWidth > 0 && el.offsetWidth < stackBelow);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stackBelow]);

  const toggleRow = (index: number, id: string, shift: boolean) => {
    const set = new Set(selected);
    if (shift && lastIndex.current != null) {
      const sorted = [lastIndex.current, index].sort((x, y) => x - y);
      const a = sorted[0] ?? index;
      const b = sorted[1] ?? index;
      const shouldSelect = !set.has(id);
      for (let i = a; i <= b; i++) {
        const row = rows[i];
        if (!row) continue;
        const rid = getRowId(row);
        if (shouldSelect) set.add(rid);
        else set.delete(rid);
      }
    } else {
      if (set.has(id)) set.delete(id);
      else set.add(id);
    }
    lastIndex.current = index;
    setSelected([...set]);
  };

  const allSelected = rows.length > 0 && rows.every((r) => selected.includes(getRowId(r)));
  const toggleAll = () => setSelected(allSelected ? [] : rows.map(getRowId));

  // Every table built on this primitive gets export for free. `sensitive` opts out.
  const csvColumns = useMemo(() => csvColumnsFromTable(columns), [columns]);
  const exportBar =
    shouldOfferTableExport(columns, { exportable, sensitive }) && rows.length > 0 ? (
      <div className={styles.tableExportBar}>
        <ExportButton
          rows={rows}
          columns={csvColumns}
          feature={exportFeature ?? ariaLabel ?? "Table"}
          orgLabel={exportOrgLabel}
          orgId={exportOrgId}
          provenance={exportProvenance}
          size="sm"
        />
      </div>
    ) : null;

  if (loading) {
    return <TableSkeleton rows={6} cols={columns.length || 4} />;
  }
  if (rows.length === 0 && emptyState != null) {
    return <div ref={ref}>{emptyState}</div>;
  }

  // Stacked card-per-row (mobile / narrow container).
  if (stacked) {
    return (
      <>
        {exportBar}
        <div ref={ref} className={[styles.stack, className].filter(Boolean).join(" ")} aria-label={ariaLabel}>
          {rows.map((row, index) => {
            const id = getRowId(row);
            const isSel = selected.includes(id);
            return (
              <div
                key={id}
                className={[styles.stackRow, isSel ? styles.stackRowSelected : undefined].filter(Boolean).join(" ")}
              >
                {selectable ? (
                  <label className={styles.stackPair}>
                    <span className={styles.stackKey}>Select</span>
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={(e) =>
                        toggleRow(index, id, (e.nativeEvent as MouseEvent).shiftKey ?? false)
                      }
                    />
                  </label>
                ) : null}
                {columns.map((col) => (
                  <div key={col.key} className={styles.stackPair}>
                    <span className={styles.stackKey}>{col.header}</span>
                    <span className={[styles.stackVal, col.numeric ? styles.cellNumeric : undefined].filter(Boolean).join(" ")}>
                      {cellContent(col, row)}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <>
      {exportBar}
      <div ref={ref} className={[styles.tableScroll, className].filter(Boolean).join(" ")}>
        <table className={styles.table} aria-label={ariaLabel}>
          <thead>
            <tr>
              {selectable ? (
                <th className={styles.selectCell}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all rows"
                  />
                </th>
              ) : null}
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={[
                    col.align === "end" ? styles.cellEnd : undefined,
                    col.sticky ? styles.stickyFirst : undefined,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const id = getRowId(row);
              const isSel = selected.includes(id);
              return (
                <tr key={id} aria-selected={selectable ? isSel : undefined}>
                  {selectable ? (
                    <td className={styles.selectCell}>
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={(e) =>
                          toggleRow(index, id, (e.nativeEvent as MouseEvent).shiftKey ?? false)
                        }
                        aria-label={`Select row ${id}`}
                      />
                    </td>
                  ) : null}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={[
                        col.align === "end" ? styles.cellEnd : undefined,
                        col.numeric ? styles.cellNumeric : undefined,
                        col.sticky ? styles.stickyFirst : undefined,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {cellContent(col, row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
