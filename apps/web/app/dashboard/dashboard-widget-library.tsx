"use client";

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "../../components/icon";
import type { WidgetCatalogEntry } from "../../lib/dashboard/catalog";
import { groupWidgetRows } from "../../lib/dashboard/edit-mode";
import { WIDGET_PICKER_ICON } from "./dashboard-canvas";
import type { PaletteRow } from "./dashboard-board-types";

/*
  The one list of widgets. There used to be two — a 29-card palette that sat
  open beside the board (and pushed the board two screens down) and a separate
  "Widget library" modal with different wording — and both cut descriptions off
  mid-sentence. This is a side sheet on a computer and a bottom sheet on a
  phone. It starts closed, searches, groups by when you would use a widget, and
  shows every description in full.

  It is not modal on purpose: on a computer you can drag a widget from it onto
  the board, which a focus-trapping overlay would block.
*/
export function DashboardWidgetLibrary({
  open,
  onClose,
  rows,
  dragOut,
  onPick,
  onBeginDrag,
  onDragPointerMove,
  onDragPointerUp,
  onDragPointerCancel,
}: {
  open: boolean;
  onClose: () => void;
  rows: PaletteRow[];
  /** A widget is being dragged out of the sheet — get out of the way of the board. */
  dragOut: boolean;
  onPick: (entry: WidgetCatalogEntry) => void;
  onBeginDrag: (event: ReactPointerEvent<HTMLElement>, entry: WidgetCatalogEntry) => void;
  onDragPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onDragPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onDragPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const [query, setQuery] = useState("");
  const sheetRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const groups = useMemo(() => groupWidgetRows(rows, query), [rows, query]);
  const addableCount = rows.filter((row) => row.status === "add").length;

  useEffect(() => {
    if (!open) return;
    // A phone keyboard popping up over the list is not what "Add widget" asked
    // for, so the search box only takes focus where there is a real keyboard.
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (coarse) sheetRef.current?.focus();
    else searchRef.current?.focus();
    const sheet = sheetRef.current;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || sheet?.contains(target)) return;
      if (target.closest("[data-testid='dash-open-library']")) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      if (sheet?.contains(document.activeElement)) {
        document.querySelector<HTMLElement>("[data-testid='dash-open-library']")?.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="dash-sheet-scrim" aria-hidden="true" data-drag-out={dragOut ? "true" : "false"} />
      <aside
        id="dash-widget-sheet"
        ref={sheetRef}
        className="dash-widget-sheet"
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="dash-widget-sheet"
        data-drag-out={dragOut ? "true" : "false"}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
        <header className="dash-sheet-head">
          <div>
            <h2 id={titleId}>Add a widget</h2>
            <p>
              <span className="dash-sheet-hint-fine">Click one to add it, or drag it onto the board.</span>
              <span className="dash-sheet-hint-coarse">Tap one to add it to your board.</span>
            </p>
          </div>
          <button type="button" className="dash-sheet-close" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        <label className="dash-sheet-search">
          <Icon name="search" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Search widgets"
            aria-label="Search widgets"
            data-testid="dash-widget-search"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="dash-sheet-list" data-testid="dash-catalog-inline">
          {addableCount === 0 && !query ? (
            <p className="dash-sheet-empty">Every widget you can use is already on your Home.</p>
          ) : null}
          {groups.length === 0 ? <p className="dash-sheet-empty">No widgets match “{query.trim()}”.</p> : null}
          {groups.map((group) => (
            <section key={group.group} aria-label={group.label}>
              <h3>{group.label}</h3>
              <ul>
                {group.rows.map(({ entry, status, reason, placedLabel, emptyNow }) => {
                  const icon = WIDGET_PICKER_ICON[entry.type] ?? "grid";
                  const addable = status === "add";
                  return (
                    <li key={entry.type}>
                      <button
                        type="button"
                        className="dash-sheet-item"
                        data-status={status}
                        data-testid={addable ? `dash-library-${entry.type}` : undefined}
                        disabled={!addable}
                        onPointerDown={(event) => {
                          if (addable) onBeginDrag(event, entry);
                        }}
                        onPointerMove={onDragPointerMove}
                        onPointerUp={onDragPointerUp}
                        onPointerCancel={onDragPointerCancel}
                        onClick={() => onPick(entry)}
                      >
                        <i aria-hidden="true">
                          <Icon name={icon} />
                        </i>
                        <span>
                          <strong>{entry.label}</strong>
                          <small>{status === "locked" && reason ? reason : entry.description}</small>
                          {addable && emptyNow ? (
                            <small className="dash-sheet-empty-note" data-testid="dash-library-empty-note">
                              Empty right now. It will stay on Home anyway (Always show).
                            </small>
                          ) : null}
                        </span>
                        <em>{status === "placed" ? placedLabel ?? "On Home" : status === "locked" ? "Locked" : "Add"}</em>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </aside>
    </>
  );
}
