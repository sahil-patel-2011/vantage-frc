/**
 * Pure grid maths for the Home Screen editor.
 *
 * Everything here is DOM-free so it can be unit tested in node: the client
 * passes in a measured rectangle and gets back cells/layouts. The collision and
 * packing primitives are the ones already used by the saved board
 * (`dashboardRectsOverlap`, `findDashboardSlot`, `packDashboardLayout` in
 * ./catalog) — this module generalises them to an arbitrary display column
 * count (phone 1-col, tablet 8-col, laptop/TV 12-col) and adds the ordering
 * rules a pointer drag and a keyboard nudge need.
 *
 * Gravity model: vertical compaction, the same rule `verticalCompactor` gave
 * the old grid. An item keeps its column band and falls to the smallest free
 * row, so a layout never has a hole directly above an item. Row targets are
 * therefore an *ordering* signal, not an absolute position.
 */

import {
  DASHBOARD_COLUMNS,
  dashboardRectsOverlap,
  packDashboardLayout,
  type DashboardWidgetLayout,
} from "./catalog";

export type GridCell = { col: number; row: number };
export type PointerPoint = { x: number; y: number };

/** The measured grid canvas, in the same coordinate space as the pointer. */
export type GridRect = { left: number; top: number; width: number };

export type NudgeDirection = "left" | "right" | "up" | "down";

/** Which item wins when two land on the same cell: the mover, or the sitter. */
export type MoveBias = "before" | "after";

/** Long-press before a touch drag begins, so a swipe still scrolls the page. */
export const DRAG_LONG_PRESS_MS = 250;

/** A pre-long-press move further than this is a scroll, not a drag. */
export const DRAG_CANCEL_DISTANCE = 10;

/** A mouse only needs a nudge to start dragging a palette chip. */
export const DRAG_MOUSE_INTENT_DISTANCE = 6;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function safeCols(cols: number): number {
  return Number.isFinite(cols) ? Math.max(1, Math.floor(cols)) : 1;
}

/**
 * Column stride in px: tracks are equal width with `gap` between them, so
 * `cols * track + (cols - 1) * gap = width`, giving `track + gap = (width + gap) / cols`.
 */
export function columnStride(width: number, cols: number, gap = 0): number {
  const columns = safeCols(cols);
  const usable = Number.isFinite(width) ? Math.max(0, width) : 0;
  return Math.max(1, (usable + Math.max(0, gap)) / columns);
}

export function rowStride(rowHeight: number, gap = 0): number {
  const height = Number.isFinite(rowHeight) ? rowHeight : 1;
  return Math.max(1, height + Math.max(0, gap));
}

/** Pixel geometry of a cell span, for absolute-positioned cards and indicators. */
export function cellBox(
  rect: Pick<DashboardWidgetLayout, "x" | "y" | "w" | "h">,
  gridWidth: number,
  cols: number,
  rowHeight: number,
  gap = 0,
): { left: number; top: number; width: number; height: number } {
  const columns = safeCols(cols);
  const colStride = columnStride(gridWidth, columns, gap);
  const track = Math.max(1, colStride - Math.max(0, gap));
  const rows = rowStride(rowHeight, gap);
  const w = Math.max(1, Math.min(columns, Math.floor(rect.w)));
  const h = Math.max(1, Math.floor(rect.h));
  return {
    left: Math.max(0, Math.floor(rect.x)) * colStride,
    top: Math.max(0, Math.floor(rect.y)) * rows,
    width: w * track + (w - 1) * Math.max(0, gap),
    height: h * Math.max(1, rowHeight) + (h - 1) * Math.max(0, gap),
  };
}

/**
 * Which grid cell a pointer (or a dragged card's top-left corner) is over.
 * Columns clamp into the board; rows never go negative but may run past the
 * last occupied row, which is how you drop a widget at the bottom.
 */
export function pointToCell(
  point: PointerPoint,
  gridRect: GridRect,
  cols: number,
  rowHeight: number,
  gap = 0,
): GridCell {
  const columns = safeCols(cols);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return { col: 0, row: 0 };
  const colStride = columnStride(gridRect.width, columns, gap);
  const rows = rowStride(rowHeight, gap);
  const col = clampInt(Math.floor((point.x - gridRect.left) / colStride), 0, columns - 1);
  const rawRow = Math.floor((point.y - gridRect.top) / rows);
  return { col, row: Number.isFinite(rawRow) ? Math.max(0, rawRow) : 0 };
}

function normalizeItem(item: DashboardWidgetLayout, cols: number): DashboardWidgetLayout {
  const w = clampInt(Math.floor(item.w), 1, cols);
  const h = Math.max(1, Math.floor(Number.isFinite(item.h) ? item.h : 1));
  const x = clampInt(Math.floor(item.x), 0, cols - w);
  const y = Number.isFinite(item.y) ? Math.max(0, Math.floor(item.y)) : 0;
  return { ...item, x, y, w, h };
}

function readingOrder(a: DashboardWidgetLayout, b: DashboardWidgetLayout): number {
  return a.y - b.y || a.x - b.x || a.i.localeCompare(b.i);
}

/**
 * Drops every item to the smallest free row in its own column band, in the
 * given priority order. Input array order is preserved in the result so React
 * keys (and `toEqual` no-op assertions) stay stable.
 */
function stackByPriority(
  layout: DashboardWidgetLayout[],
  priority: readonly string[],
  cols: number,
): DashboardWidgetLayout[] {
  const columns = safeCols(cols);
  const rank = new Map(priority.map((id, index) => [id, index]));
  const prepared = layout.map((item) => normalizeItem(item, columns));
  const queue = [...prepared].sort(
    (a, b) => (rank.get(a.i) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.i) ?? Number.MAX_SAFE_INTEGER),
  );

  const placed: DashboardWidgetLayout[] = [];
  const settled = new Map<string, DashboardWidgetLayout>();
  for (const item of queue) {
    let y = 0;
    while (placed.some((other) => dashboardRectsOverlap({ x: item.x, y, w: item.w, h: item.h }, other))) {
      y += 1;
    }
    const resolved = { ...item, y };
    placed.push(resolved);
    settled.set(resolved.i, resolved);
  }
  return prepared.map((item) => settled.get(item.i) ?? item);
}

/** Vertical compaction: keep columns, pull everything up, break no overlaps. */
export function compactLayout(
  layout: DashboardWidgetLayout[],
  cols: number = DASHBOARD_COLUMNS,
): DashboardWidgetLayout[] {
  const columns = safeCols(cols);
  const priority = layout
    .map((item) => normalizeItem(item, columns))
    .sort(readingOrder)
    .map((item) => item.i);
  return stackByPriority(layout, priority, columns);
}

/**
 * Moves one widget so its top-left sits on `toCell`, then re-settles the board.
 * Used by the pointer drag on every cell change and by the keyboard nudge.
 */
export function moveItem(
  layout: DashboardWidgetLayout[],
  id: string,
  toCell: GridCell,
  cols: number = DASHBOARD_COLUMNS,
  options?: {
    bias?: MoveBias;
    /**
     * Order the mover immediately before/after this specific widget instead of
     * letting the row/column sort decide. A swap with a neighbour that starts
     * in a different column has no positional tie to break, so the keyboard
     * path names the neighbour outright.
     */
    relativeTo?: string;
  },
): DashboardWidgetLayout[] {
  const columns = safeCols(cols);
  const source = layout.find((item) => item.i === id);
  if (!source) return compactLayout(layout, columns);

  const current = normalizeItem(source, columns);
  const col = clampInt(Math.floor(toCell.col), 0, columns - current.w);
  const row = Number.isFinite(toCell.row) ? Math.max(0, Math.floor(toCell.row)) : 0;

  // Dropping lower/further right means the mover yields the contested cell and
  // lands underneath; dropping higher/further left means it takes the cell.
  const movingForward = row > current.y || (row === current.y && col > current.x);
  const bias: MoveBias = options?.bias ?? (movingForward ? "after" : "before");

  const next = layout.map((item) =>
    item.i === id ? { ...normalizeItem(item, columns), x: col, y: row } : normalizeItem(item, columns),
  );

  let priority: string[];
  if (options?.relativeTo && options.relativeTo !== id) {
    const rest = next.filter((entry) => entry.i !== id).sort(readingOrder);
    const anchor = rest.findIndex((entry) => entry.i === options.relativeTo);
    const ids = rest.map((entry) => entry.i);
    ids.splice(anchor < 0 ? ids.length : bias === "before" ? anchor : anchor + 1, 0, id);
    priority = ids;
  } else {
    priority = [...next]
      .sort((a, b) => {
        const positional = a.y - b.y || a.x - b.x;
        if (positional !== 0) return positional;
        if (a.i === id) return bias === "before" ? -1 : 1;
        if (b.i === id) return bias === "before" ? 1 : -1;
        return a.i.localeCompare(b.i);
      })
      .map((item) => item.i);
  }

  return stackByPriority(next, priority, columns);
}

function bandsOverlap(a: DashboardWidgetLayout, b: DashboardWidgetLayout): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x;
}

function nearestAbove(layout: DashboardWidgetLayout[], item: DashboardWidgetLayout) {
  return layout
    .filter((other) => other.i !== item.i && bandsOverlap(item, other) && other.y + other.h <= item.y)
    .sort((a, b) => b.y + b.h - (a.y + a.h) || a.x - b.x)[0];
}

function nearestBelow(layout: DashboardWidgetLayout[], item: DashboardWidgetLayout) {
  return layout
    .filter((other) => other.i !== item.i && bandsOverlap(item, other) && other.y >= item.y + item.h)
    .sort((a, b) => a.y - b.y || a.x - b.x)[0];
}

/**
 * Keyboard reordering. Left/right shift by exactly one column. Up/down swap
 * with the neighbour stacked directly above/below — under vertical gravity a
 * one-row nudge would just fall back where it started, so a swap is the move
 * the student actually meant. Returns the layout unchanged when the widget is
 * already at that edge, which the caller announces.
 */
export function nudgeItem(
  layout: DashboardWidgetLayout[],
  id: string,
  direction: NudgeDirection,
  cols: number = DASHBOARD_COLUMNS,
): DashboardWidgetLayout[] {
  const columns = safeCols(cols);
  const settled = compactLayout(layout, columns);
  const item = settled.find((entry) => entry.i === id);
  if (!item) return settled;

  if (direction === "left" || direction === "right") {
    const col = item.x + (direction === "left" ? -1 : 1);
    if (col < 0 || col + item.w > columns) return settled;
    return moveItem(settled, id, { col, row: item.y }, columns, { bias: "before" });
  }

  const neighbour = direction === "up" ? nearestAbove(settled, item) : nearestBelow(settled, item);
  if (!neighbour) return settled;
  return moveItem(settled, id, { col: item.x, row: neighbour.y }, columns, {
    bias: direction === "up" ? "before" : "after",
    relativeTo: neighbour.i,
  });
}

/**
 * Re-flows the saved 12-column board to match a new top-to-bottom order. This
 * is the phone path: a one-column drag expresses order, not geometry, so we
 * keep every widget's saved width instead of flattening the board to 12-wide
 * rows. Packing is `packDashboardLayout`, unchanged.
 */
export function reorderLayout(
  layout: DashboardWidgetLayout[],
  orderedIds: readonly string[],
): DashboardWidgetLayout[] {
  const rank = new Map(orderedIds.map((id, index) => [id, index]));
  const trailing = orderedIds.length;
  const spaced = layout.map((item, index) => ({
    ...item,
    x: 0,
    y: (rank.get(item.i) ?? trailing + index) * 1000,
  }));
  const packed = packDashboardLayout(spaced);
  const byId = new Map(packed.map((item) => [item.i, item]));
  return layout.map((item) => byId.get(item.i) ?? item);
}

/** Top-to-bottom, left-to-right ids — the order a screen reader reads a board. */
export function layoutOrder(layout: DashboardWidgetLayout[]): string[] {
  return [...layout].sort(readingOrder).map((item) => item.i);
}

export function layoutBottom(layout: DashboardWidgetLayout[]): number {
  return layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
}

/* ---- invariants, exported so the client and the tests check the same thing ---- */

export function layoutHasOverlap(layout: DashboardWidgetLayout[]): boolean {
  for (let i = 0; i < layout.length; i += 1) {
    for (let j = i + 1; j < layout.length; j += 1) {
      if (dashboardRectsOverlap(layout[i]!, layout[j]!)) return true;
    }
  }
  return false;
}

export function layoutFitsColumns(layout: DashboardWidgetLayout[], cols: number): boolean {
  const columns = safeCols(cols);
  return layout.every((item) => item.x >= 0 && item.w >= 1 && item.x + item.w <= columns && item.y >= 0);
}

/** True when no widget could move up a row without hitting something. */
export function layoutIsPacked(layout: DashboardWidgetLayout[]): boolean {
  return layout.every((item) => {
    if (item.y === 0) return true;
    const lifted = { x: item.x, y: item.y - 1, w: item.w, h: item.h };
    return layout.some((other) => other.i !== item.i && dashboardRectsOverlap(lifted, other));
  });
}

/* ---- gesture helpers ---- */

export function pointerDistance(from: PointerPoint, to: PointerPoint): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

export function exceedsDragCancelDistance(
  from: PointerPoint,
  to: PointerPoint,
  threshold: number = DRAG_CANCEL_DISTANCE,
): boolean {
  return pointerDistance(from, to) > threshold;
}

/**
 * Page scroll speed while a card is dragged near a viewport edge. Negative
 * scrolls up. Returns 0 in the calm middle of the screen.
 */
export function edgeAutoScrollDelta(
  clientY: number,
  viewportHeight: number,
  options?: { zone?: number; maxSpeed?: number },
): number {
  const zone = Math.max(1, options?.zone ?? 96);
  const maxSpeed = Math.max(1, options?.maxSpeed ?? 18);
  if (!Number.isFinite(clientY) || !Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;

  if (clientY < zone) {
    const intensity = Math.min(1, (zone - clientY) / zone);
    return -Math.ceil(intensity * maxSpeed);
  }
  const fromBottom = viewportHeight - clientY;
  if (fromBottom < zone) {
    const intensity = Math.min(1, (zone - fromBottom) / zone);
    return Math.ceil(intensity * maxSpeed);
  }
  return 0;
}

/** aria-live copy: "Next match moved to row 2, column 1". */
export function describeCellMove(label: string, cell: { col: number; row: number }): string {
  return `${label} moved to row ${Math.max(0, cell.row) + 1}, column ${Math.max(0, cell.col) + 1}`;
}
