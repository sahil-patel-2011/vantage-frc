/**
 * Home's board as an ordered list of cards.
 *
 * Home lays a board out one way: every card, in reading order, takes the first
 * free spot from the top-left (packDashboardLayout). Edit mode used to move
 * cards with a different rule — vertical gravity inside column bands — so a
 * drop could leave a hole that Home then closed on its own, and the edit board,
 * Preview and Home disagreed about where things were.
 *
 * Here a move is a change of order, never a free position: a drop onto a card
 * the same size swaps the two, a drop onto a different-size card goes before or
 * after it, and a drop on empty space goes where that space falls in reading
 * order. The board is then packed with Home's own rule, so the dashed slot
 * during a drag is exactly where the card lands and exactly where Home shows it.
 * DOM-free so it runs under vitest.
 */

import {
  DASHBOARD_COLUMNS,
  catalogEntry,
  packDashboardLayout,
  packKeepingOrder,
  scaleLayoutToCols,
  type DashboardWidgetLayout,
} from "./catalog";

export type OrderDirection = "left" | "right" | "up" | "down";

/** Reading order: top to bottom, then left to right. */
export function readingOrder(layout: readonly DashboardWidgetLayout[]): string[] {
  return [...layout].sort((a, b) => a.y - b.y || a.x - b.x || a.i.localeCompare(b.i)).map((item) => item.i);
}

/**
 * First-fit packing in a given order (reading order when none is given), for
 * any column count. The array keeps its own order so React keys stay put.
 */
export function packInOrder(
  layout: readonly DashboardWidgetLayout[],
  cols: number = DASHBOARD_COLUMNS,
  order?: readonly string[],
): DashboardWidgetLayout[] {
  const columns = Math.max(1, Math.floor(cols) || 1);
  const ids = order ?? readingOrder(layout);
  const rank = new Map(ids.map((id, index) => [id, index]));
  const queue = [...layout].sort(
    (a, b) => (rank.get(a.i) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.i) ?? Number.MAX_SAFE_INTEGER),
  );
  const placed = packKeepingOrder(queue, columns);
  const byId = new Map(placed.map((item) => [item.i, item]));
  return layout.map((item) => byId.get(item.i) ?? { ...item });
}

function samePlaces(a: readonly DashboardWidgetLayout[], b: readonly DashboardWidgetLayout[]): boolean {
  const byId = new Map(b.map((item) => [item.i, item]));
  return a.every((item) => {
    const other = byId.get(item.i);
    return Boolean(other && other.x === item.x && other.y === item.y && other.w === item.w && other.h === item.h);
  });
}

/**
 * Packed so that packing it again (which is what Home does with a saved board)
 * changes nothing. First-fit can drop a later card into a hole above an earlier
 * one; re-packing in the new reading order settles that once and for all.
 */
export function packStable(
  layout: readonly DashboardWidgetLayout[],
  cols: number = DASHBOARD_COLUMNS,
  order?: readonly string[],
): DashboardWidgetLayout[] {
  let current = packInOrder(layout, cols, order);
  for (let pass = 0; pass < 6; pass += 1) {
    const next = packInOrder(current, cols);
    if (samePlaces(current, next)) return current;
    current = next;
  }
  return current;
}

/**
 * The saved 12-column board as a screen of `cols` columns shows it: scaled,
 * then packed in the 12-column reading order. Scaling a phone to one column
 * makes every card x=0, so sorting afterwards put two cards from the same row
 * in id order — the phone showed Ask AI before Hours when the desktop showed
 * Hours first. The order is taken before scaling.
 */
export function displayBoard(view: readonly DashboardWidgetLayout[], cols: number): DashboardWidgetLayout[] {
  const order = readingOrder(view);
  return packInOrder(scaleLayoutToCols([...view], DASHBOARD_COLUMNS, cols), cols, order);
}

/** True when Home would lay this board out exactly as it is. */
export function isHomePacked(layout: readonly DashboardWidgetLayout[]): boolean {
  return samePlaces(layout, packDashboardLayout([...layout]));
}

/**
 * The saved 12-column board with the cards on the edit board in `visibleOrder`.
 * Cards not in the order (the ones Home is hiding right now) are tucked below,
 * where the "Hidden right now" row lists them, so they never sit in a hole
 * among the cards you can see.
 */
export function applyOrder(
  saved: readonly DashboardWidgetLayout[],
  visibleOrder: readonly string[],
): DashboardWidgetLayout[] {
  const wanted = new Set(visibleOrder);
  const visible = saved.filter((item) => wanted.has(item.i));
  const packed = packStable(visible, DASHBOARD_COLUMNS, visibleOrder);
  const bottom = packed.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  const tucked = packDashboardLayout(saved.filter((item) => !wanted.has(item.i))).map((item) => ({
    ...item,
    y: item.y + bottom,
  }));
  const byId = new Map([...packed, ...tucked].map((item) => [item.i, item]));
  return saved.map((item) => byId.get(item.i) ?? item);
}

export type DropPlan = {
  order: string[];
  /** The card the drop is measured against, if any. */
  targetId: string | null;
  mode: "swap" | "before" | "after" | "gap" | "stay";
};

function contains(item: DashboardWidgetLayout, col: number, row: number) {
  return col >= item.x && col < item.x + item.w && row >= item.y && row < item.y + item.h;
}

/**
 * Where a dragged card goes when released at a pointer position, expressed in
 * grid cells (fractions allowed) on the board as it was when the drag began.
 * Always judged against that starting board, so the answer never flickers as
 * the preview moves cards around under the pointer.
 */
export function planDrop(
  display: readonly DashboardWidgetLayout[],
  dragId: string,
  point: { col: number; row: number },
  cols: number,
): DropPlan {
  const base = readingOrder(display);
  const dragged = display.find((item) => item.i === dragId);
  if (!dragged) return { order: base, targetId: null, mode: "stay" };
  const others = base.filter((id) => id !== dragId);
  const byId = new Map(display.map((item) => [item.i, item]));
  const target = display.find((item) => item.i !== dragId && contains(item, point.col, point.row));

  if (!target) {
    if (contains(dragged, point.col, point.row)) return { order: base, targetId: null, mode: "stay" };
    const row = Math.floor(point.row);
    const col = Math.floor(point.col);
    const index = others.filter((id) => {
      const item = byId.get(id)!;
      return item.y < row || (item.y === row && item.x < col);
    }).length;
    const order = [...others.slice(0, index), dragId, ...others.slice(index)];
    return { order, targetId: others[index - 1] ?? others[index] ?? null, mode: "gap" };
  }

  if (target.w === dragged.w && target.h === dragged.h) {
    const order = base.map((id) => (id === dragId ? target.i : id === target.i ? dragId : id));
    return { order, targetId: target.i, mode: "swap" };
  }

  const fullWidth = cols <= 1 || target.w >= cols;
  const fraction = fullWidth ? (point.row - target.y) / target.h : (point.col - target.x) / target.w;
  const before = fraction < 0.5;
  const at = others.indexOf(target.i);
  const index = before ? at : at + 1;
  const order = [...others.slice(0, index), dragId, ...others.slice(index)];
  return { order, targetId: target.i, mode: before ? "before" : "after" };
}

function labelOf(display: readonly DashboardWidgetLayout[], id: string | null): string | null {
  if (!id) return null;
  const item = display.find((row) => row.i === id);
  return item ? catalogEntry(item.type)?.label ?? item.type : null;
}

/** "after Next match", "before Ask AI", "swapping with Hours this month" — card words, not grid words. */
export function describePlace(
  display: readonly DashboardWidgetLayout[],
  order: readonly string[],
  id: string,
  mode?: DropPlan["mode"],
  targetId?: string | null,
): string {
  if (mode === "swap") {
    const label = labelOf(display, targetId ?? null);
    if (label) return `swapping with ${label}`;
  }
  const at = order.indexOf(id);
  const previous = labelOf(display, at > 0 ? order[at - 1]! : null);
  if (previous) return `after ${previous}`;
  const next = labelOf(display, order[at + 1] ?? null);
  return next ? `first, before ${next}` : "on its own";
}

function bandsOverlap(a: DashboardWidgetLayout, b: DashboardWidgetLayout): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x;
}

/**
 * Keyboard move. Left and right trade places with the card before or after in
 * reading order; up and down go to the card directly above or below. Same-size
 * neighbours swap, others insert, and the board packs the Home way. Returns
 * null when the card is already at that edge.
 */
export function nudgeOrder(
  display: readonly DashboardWidgetLayout[],
  id: string,
  direction: OrderDirection,
): string[] | null {
  const order = readingOrder(display);
  const at = order.indexOf(id);
  const item = display.find((row) => row.i === id);
  if (at < 0 || !item) return null;

  if (direction === "left" || direction === "right") {
    const other = direction === "left" ? at - 1 : at + 1;
    if (other < 0 || other >= order.length) return null;
    const next = [...order];
    [next[at], next[other]] = [next[other]!, next[at]!];
    return next;
  }

  const candidates = display.filter((other) =>
    other.i !== id && bandsOverlap(item, other) && (direction === "up" ? other.y + other.h <= item.y : other.y >= item.y + item.h),
  );
  candidates.sort((a, b) =>
    direction === "up" ? b.y + b.h - (a.y + a.h) || a.x - b.x : a.y - b.y || a.x - b.x,
  );
  const neighbour = candidates[0] ?? display.find((other) => other.i === order[direction === "up" ? at - 1 : at + 1]);
  if (!neighbour) return null;
  if (neighbour.w === item.w && neighbour.h === item.h) {
    return order.map((entry) => (entry === id ? neighbour.i : entry === neighbour.i ? id : entry));
  }
  const rest = order.filter((entry) => entry !== id);
  const index = rest.indexOf(neighbour.i) + (direction === "up" ? 0 : 1);
  return [...rest.slice(0, index), id, ...rest.slice(index)];
}
