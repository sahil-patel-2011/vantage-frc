"use client";

import { Icon } from "../../components/icon";
import { Modal } from "../../components/ui";
import type { WidgetCatalogEntry } from "../../lib/dashboard/catalog";
import { WIDGET_PICKER_ICON } from "./dashboard-canvas";
import type { PaletteRow } from "./dashboard-board-types";

export function DashboardWidgetLibrary({
  open,
  onClose,
  addableEntries,
  paletteEntries,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  addableEntries: PaletteRow[];
  paletteEntries: PaletteRow[];
  onPick: (entry: WidgetCatalogEntry, pointerType: string) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Widget library"
      description="On a phone, tap a card then tap a slot on the board. On a computer, click to add it."
      variant="sheet"
    >
      {addableEntries.length === 0 ? (
        <p className="dash-library-empty">Every widget you can use is already on your Home Screen.</p>
      ) : (
        <ul className="dash-library-grid">
          {addableEntries.map(({ entry }) => {
            const icon = WIDGET_PICKER_ICON[entry.type] ?? "grid";
            return (
              <li key={entry.type}>
                <button
                  type="button"
                  data-testid={`dash-library-${entry.type}`}
                  onClick={(event) => {
                    const native = event.nativeEvent;
                    const pointerType =
                      "pointerType" in native ? String((native as PointerEvent).pointerType) : "";
                    onPick(entry, pointerType);
                  }}
                  title={entry.description}
                >
                  <i>
                    <Icon name={icon} />
                  </i>
                  <strong>{entry.label}</strong>
                  <span>{entry.description}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="dash-library-onboard">
        <p>Not addable right now</p>
        <div className="dash-catalog">
          {paletteEntries
            .filter((row) => row.status !== "add")
            .map(({ entry, status, reason }) => (
              <button key={entry.type} type="button" disabled title={reason ?? undefined}>
                {status === "placed" ? `On board · ${entry.label}` : `${entry.label} · ${reason}`}
              </button>
            ))}
          {paletteEntries.every((row) => row.status === "add") ? (
            <p className="dash-library-empty">Nothing is held back — every widget is available.</p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
