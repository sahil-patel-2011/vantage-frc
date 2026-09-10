"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { downloadCsv } from "../../lib/export/download-csv";
import { csvFileName, describeCsvColumns, toCsv, type CsvColumn } from "../../lib/export/to-csv";
import "./export-button.css";

export type { CsvColumn } from "../../lib/export/to-csv";

type ExportButtonProps<Row> = {
  /** Exactly the rows the user is looking at — filters and sort included. */
  rows: readonly Row[];
  columns: readonly CsvColumn<Row>[];
  /** Human name of the table. Becomes the filename stem and the tooltip title. */
  feature: string;
  /** Team number / workspace name, folded into the filename so files stay distinguishable. */
  orgLabel?: string | null;
  /** Deep-links the "full export" tooltip line to this team's Export Center. */
  orgId?: string | null;
  label?: string;
  /** Compact variant for a panel header sitting beside an <h2>. */
  size?: "sm" | "md";
  className?: string;
  disabled?: boolean;
  /** One line naming where these rows came from — shown above the column list. */
  provenance?: string;
};

const ARROW = (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
    <path
      d="M8 1.75v7.5m0 0L5.25 6.5M8 9.25l2.75-2.75M2.75 11.5v1.25c0 .69.56 1.25 1.25 1.25h8c.69 0 1.25-.56 1.25-1.25V11.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * One-click CSV of the rows already on screen.
 *
 * Teams' analysis lives in Sheets/Tableau/Excel; a table without export gets re-typed
 * by hand. This builds the file in the browser from the rows already rendered — no
 * round trip, so it works on venue Wi-Fi — and never invents a row the page is not
 * showing. The info popover names every column and points at Export Center for the
 * full archive, so the in-place button and the /exports hub reinforce each other.
 */
export function ExportButton<Row>({
  rows,
  columns,
  feature,
  orgLabel,
  orgId,
  label = "Export CSV",
  size = "md",
  className,
  disabled = false,
  provenance,
}: ExportButtonProps<Row>) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<CSSProperties | null>(null);
  const [status, setStatus] = useState("");
  const infoRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  const columnLines = useMemo(() => describeCsvColumns(columns), [columns]);
  const count = rows.length;
  const empty = count === 0 || columns.length === 0;
  const exportsHref = orgId ? `/exports?orgId=${encodeURIComponent(orgId)}` : "/exports";

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) infoRef.current?.focus();
  }, []);

  // Position against the trigger's rect; the panel is portalled so a scrollable
  // table ancestor cannot clip it.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = infoRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAnchor({
        top: Math.round(rect.bottom + 6),
        left: Math.round(Math.min(rect.left, window.innerWidth - 316)),
        maxHeight: Math.round(window.innerHeight - rect.bottom - 24),
      });
    };
    place();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || infoRef.current?.contains(target)) return;
      close(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, close]);

  const run = useCallback(() => {
    if (empty) return;
    const fileName = csvFileName(feature, orgLabel);
    const result = downloadCsv(fileName, toCsv(rows, columns));
    if (result === "too-large") {
      setStatus(`This table is too large for an in-place export. Open Export Center for the full archive.`);
      return;
    }
    if (result === "unsupported") {
      setStatus("This browser could not save the file. Open Export Center instead.");
      return;
    }
    setStatus(`Exported ${count} ${count === 1 ? "row" : "rows"} to ${fileName}`);
  }, [columns, count, empty, feature, orgLabel, rows]);

  return (
    <div className={["vex-root", size === "sm" ? "vex-sm" : "", className].filter(Boolean).join(" ")}>
      <button
        type="button"
        className="vex-btn"
        onClick={run}
        disabled={disabled || empty}
        title={empty ? "Nothing to export yet" : `Download these ${count} rows as a CSV`}
        data-testid="export-csv"
      >
        {ARROW}
        <span className="vex-label">{label}</span>
        {count > 0 ? <span className="vex-count">{count}</span> : null}
      </button>
      <button
        ref={infoRef}
        type="button"
        className="vex-info"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`What's in the ${feature} CSV`}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">i</span>
      </button>

      <p className="vex-status" role="status" aria-live="polite">
        {status}
      </p>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div ref={panelRef} id={panelId} className="vex-panel" style={anchor ?? { top: -9999, left: -9999 }}>
              <strong className="vex-panel-title">What&apos;s in this file</strong>
              <p className="vex-panel-sub">
                {feature} — {count} {count === 1 ? "row" : "rows"} exactly as filtered on screen. UTF-8 CSV,
                opens in Sheets, Excel, or Tableau.
              </p>
              {provenance ? <p className="vex-panel-sub">{provenance}</p> : null}
              <ul className="vex-panel-cols">
                {columnLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <a className="vex-panel-link" href={exportsHref}>
                Need everything? Full export →
              </a>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
