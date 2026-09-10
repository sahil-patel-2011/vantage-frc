/**
 * Apple-style Home edit on a phone: tap a widget in the gallery, then tap a
 * slot on the board. Drag-to-place stays for fine pointers.
 */

import { dropWidgetOntoLayout } from "./boards";
import type { DashboardWidgetLayout, DashboardWidgetType } from "./catalog";

export function prefersTapToPlace(input: { pointerType?: string; coarse?: boolean }): boolean {
  if (input.coarse === true) return true;
  const pointer = (input.pointerType ?? "").toLowerCase();
  return pointer === "touch" || pointer === "pen";
}

export function placePendingWidget(
  layout: DashboardWidgetLayout[],
  pendingType: DashboardWidgetType | null,
  slot: { x: number; y: number } | null,
  options?: { displayCols?: number; now?: number },
) {
  if (!pendingType) {
    return { ok: false as const, error: "Pick a widget first, then tap a slot on the board." };
  }
  return dropWidgetOntoLayout(layout, pendingType, {
    drop: slot ?? undefined,
    displayCols: options?.displayCols,
    now: options?.now,
  });
}
