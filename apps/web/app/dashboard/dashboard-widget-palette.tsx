"use client";

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "../../components/icon";
import type { WidgetCatalogEntry } from "../../lib/dashboard/catalog";
import { WIDGET_PICKER_ICON } from "./dashboard-canvas";
import type { PaletteRow } from "./dashboard-board-types";

export function DashboardWidgetPalette({
  cols,
  gridLabel,
  layoutCount,
  addableCount,
  paletteEntries,
  draggingType,
  saving,
  libraryOpen,
  orgId,
  canShareOrg,
  onTidy,
  onToggleLibrary,
  onSave,
  onBeginPaletteDrag,
  onDragPointerMove,
  onDragPointerUp,
  onDragPointerCancel,
  onPaletteClick,
}: {
  cols: number;
  gridLabel: string;
  layoutCount: number;
  addableCount: number;
  paletteEntries: PaletteRow[];
  draggingType: string | null;
  saving: boolean;
  libraryOpen: boolean;
  orgId?: string | null;
  canShareOrg: boolean;
  onTidy: () => void;
  onToggleLibrary: () => void;
  onSave: () => void;
  onBeginPaletteDrag: (event: ReactPointerEvent<HTMLElement>, entry: WidgetCatalogEntry) => void;
  onDragPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onDragPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onDragPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onPaletteClick: (entry: WidgetCatalogEntry, event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <section className="dash-editor-bar" role="region" aria-label="Widget catalog">
      <div className="dash-edit-strip" role="toolbar" aria-label="Edit Home toolbar">
        <span className="dash-edit-flag">
          <i aria-hidden="true" />
          Edit mode
        </span>
        <span className="dash-edit-meta">
          {cols === 1 ? "Single column" : `${cols}-column grid`} · {gridLabel} · {layoutCount} widget
          {layoutCount === 1 ? "" : "s"}
        </span>
        <div className="dash-edit-strip-actions">
          <button type="button" disabled={saving} onClick={onTidy}>
            Snap &amp; tidy
          </button>
          <button type="button" aria-pressed={libraryOpen} onClick={onToggleLibrary}>
            Widget library
          </button>
          <button className="is-primary" type="button" disabled={saving} onClick={onSave}>
            {saving ? "Saving…" : "Done"}
          </button>
        </div>
      </div>
      <div className="dash-editor-copy">
        <strong>Customize Home</strong>
        <span>
          Press and hold a card — or use its grip — to move it. Keyboard: focus a grip, press space, then
          use the arrow keys.
          {orgId
            ? canShareOrg
              ? " Done saves your personal Home. Save for team is optional and does not overwrite teammates' layouts."
              : " Done saves your personal Home — teammates keep their own layouts."
            : " Select a team to save this layout."}
        </span>
      </div>
      <div className="dash-palette-heading">
        <span>Add widgets</span>
        <small>
          {layoutCount} on board · {addableCount} available
        </small>
      </div>
      <div className="dash-widget-palette" data-testid="dash-catalog-inline">
        {paletteEntries.map(({ entry, status, reason }) => {
          const icon = WIDGET_PICKER_ICON[entry.type] ?? "grid";
          const isDragging = draggingType === entry.type;
          return (
            <button
              className={`${status === "add" ? "" : "is-unavailable "}${isDragging ? "dragging" : ""}`.trim()}
              key={entry.type}
              type="button"
              data-status={status}
              disabled={status !== "add"}
              title={
                status === "placed"
                  ? `${entry.label} is already on the board.`
                  : status === "locked"
                    ? `${entry.label} — ${reason}`
                    : `${entry.description}. Drag onto the board or tap to add.`
              }
              onPointerDown={(event) => {
                if (status !== "add") return;
                onBeginPaletteDrag(event, entry);
              }}
              onPointerMove={onDragPointerMove}
              onPointerUp={onDragPointerUp}
              onPointerCancel={onDragPointerCancel}
              onClick={(event) => onPaletteClick(entry, event)}
            >
              <i>
                <Icon name={icon} />
              </i>
              <span>
                <strong>{entry.label}</strong>
                <small>{status === "locked" ? reason : entry.description}</small>
              </span>
              <em>{status === "placed" ? "On board" : status === "locked" ? "Locked" : "Add"}</em>
            </button>
          );
        })}
      </div>
    </section>
  );
}
