import { describe, expect, it } from "vitest";
import { DASHBOARD_COLUMNS, DEFAULT_DASHBOARD_LAYOUT, type DashboardWidgetLayout } from "./catalog";
import {
  cellBox,
  columnStride,
  compactLayout,
  describeCellMove,
  edgeAutoScrollDelta,
  exceedsDragCancelDistance,
  layoutBottom,
  layoutFitsColumns,
  layoutHasOverlap,
  layoutIsPacked,
  layoutOrder,
  moveItem,
  nudgeItem,
  pointToCell,
  reorderLayout,
} from "./grid-drag";

const GRID = { left: 100, top: 50, width: 1200 };

function item(
  i: string,
  x: number,
  y: number,
  w: number,
  h: number,
): DashboardWidgetLayout {
  return { i, type: "alerts", x, y, w, h };
}

/** A board with one full-width header and three cards under it. */
function board(): DashboardWidgetLayout[] {
  return [
    { i: "hero", type: "next_match", x: 0, y: 0, w: 12, h: 4 },
    { i: "left", type: "alerts", x: 0, y: 4, w: 4, h: 3 },
    { i: "mid", type: "recent_result", x: 4, y: 4, w: 4, h: 3 },
    { i: "right", type: "scouting_coverage", x: 8, y: 4, w: 4, h: 3 },
  ];
}

function expectHealthy(layout: DashboardWidgetLayout[], cols = DASHBOARD_COLUMNS) {
  expect(layoutHasOverlap(layout)).toBe(false);
  expect(layoutFitsColumns(layout, cols)).toBe(true);
  expect(layoutIsPacked(layout)).toBe(true);
}

describe("pointToCell", () => {
  it("maps a pointer inside the grid to its column and row", () => {
    // 12 columns, 1200px wide, no gap -> 100px per column.
    expect(pointToCell({ x: 100, y: 50 }, GRID, 12, 80)).toEqual({ col: 0, row: 0 });
    expect(pointToCell({ x: 750, y: 50 }, GRID, 12, 80)).toEqual({ col: 6, row: 0 });
    expect(pointToCell({ x: 100, y: 50 + 161 }, GRID, 12, 80)).toEqual({ col: 0, row: 2 });
  });

  it("accounts for the gap between tracks", () => {
    // gap 12 -> stride (1200 + 12) / 12 = 101px.
    expect(pointToCell({ x: 100 + 101 * 3 + 5, y: 50 }, GRID, 12, 80, 12).col).toBe(3);
    // row stride is rowHeight + gap.
    expect(pointToCell({ x: 100, y: 50 + 92 * 2 + 3 }, GRID, 12, 80, 12).row).toBe(2);
  });

  it("clamps columns into the board and never returns a negative row", () => {
    expect(pointToCell({ x: -9000, y: -9000 }, GRID, 12, 80)).toEqual({ col: 0, row: 0 });
    expect(pointToCell({ x: 9000, y: 50 }, GRID, 12, 80).col).toBe(11);
    expect(pointToCell({ x: 9000, y: 50 }, GRID, 4, 80).col).toBe(3);
  });

  it("survives an unmeasured grid instead of producing NaN cells", () => {
    const cell = pointToCell({ x: 10, y: 10 }, { left: 0, top: 0, width: 0 }, 12, 0);
    expect(Number.isFinite(cell.col)).toBe(true);
    expect(Number.isFinite(cell.row)).toBe(true);
  });

  it("round-trips against cellBox so the drop indicator lands under the pointer", () => {
    const box = cellBox({ x: 5, y: 3, w: 3, h: 2 }, GRID.width, 12, 80, 12);
    const cell = pointToCell(
      { x: GRID.left + box.left + 2, y: GRID.top + box.top + 2 },
      GRID,
      12,
      80,
      12,
    );
    expect(cell).toEqual({ col: 5, row: 3 });
  });

  it("keeps the stride positive for a degenerate width", () => {
    expect(columnStride(0, 12, 0)).toBeGreaterThan(0);
    expect(columnStride(Number.NaN, 12, 0)).toBeGreaterThan(0);
  });
});

describe("moveItem", () => {
  it("is a no-op when the widget is dropped back on its own cell", () => {
    const start = compactLayout(board());
    const same = moveItem(start, "mid", { col: 4, row: 4 }, DASHBOARD_COLUMNS);
    expect(same).toEqual(start);
  });

  it("moves a widget to the pointed-at column", () => {
    const next = moveItem(compactLayout(board()), "left", { col: 8, row: 4 });
    const moved = next.find((entry) => entry.i === "left")!;
    expect(moved.x).toBe(8);
    expectHealthy(next);
  });

  it("never overlaps, whatever cell it is thrown at", () => {
    const start = compactLayout(board());
    for (const id of ["hero", "left", "mid", "right"]) {
      for (let col = -3; col <= 15; col += 1) {
        for (let row = -2; row <= 12; row += 1) {
          expectHealthy(moveItem(start, id, { col, row }));
        }
      }
    }
  });

  it("keeps every widget inside the column count on a narrow grid", () => {
    const narrow = compactLayout(
      [item("a", 0, 0, 2, 2), item("b", 2, 0, 2, 2), item("c", 0, 2, 4, 2)],
      4,
    );
    const next = moveItem(narrow, "a", { col: 99, row: 99 }, 4);
    expectHealthy(next, 4);
    expect(next.every((entry) => entry.x + entry.w <= 4)).toBe(true);
  });

  it("leaves no hole above a widget after a move", () => {
    const start = compactLayout(board());
    const next = moveItem(start, "hero", { col: 0, row: 20 });
    expect(layoutIsPacked(next)).toBe(true);
    expect(layoutBottom(next)).toBeLessThanOrEqual(layoutBottom(start));
  });

  it("swaps a stacked pair when the mover is dropped on the sitter's cell", () => {
    const stacked = compactLayout([item("a", 0, 0, 12, 3), item("b", 0, 3, 12, 3)]);
    const next = moveItem(stacked, "b", { col: 0, row: 0 });
    expect(next.find((entry) => entry.i === "b")!.y).toBe(0);
    expect(next.find((entry) => entry.i === "a")!.y).toBe(3);
    expectHealthy(next);
  });

  it("puts the mover underneath when it is dropped downward onto a sitter", () => {
    const stacked = compactLayout([item("a", 0, 0, 12, 3), item("b", 0, 3, 12, 3)]);
    const next = moveItem(stacked, "a", { col: 0, row: 3 });
    expect(next.find((entry) => entry.i === "b")!.y).toBe(0);
    expect(next.find((entry) => entry.i === "a")!.y).toBe(3);
  });

  it("ignores an unknown id but still returns a settled board", () => {
    const start = board();
    expect(moveItem(start, "nope", { col: 2, row: 2 })).toEqual(compactLayout(start));
  });

  it("keeps the input array order so React keys stay stable", () => {
    const start = compactLayout(board());
    const next = moveItem(start, "right", { col: 0, row: 0 });
    expect(next.map((entry) => entry.i)).toEqual(start.map((entry) => entry.i));
  });
});

describe("compactLayout", () => {
  it("pulls a floating widget up to the first free row", () => {
    const floaty = [item("a", 0, 0, 6, 2), item("b", 0, 9, 6, 2)];
    const next = compactLayout(floaty);
    expect(next.find((entry) => entry.i === "b")!.y).toBe(2);
    expectHealthy(next);
  });

  it("resolves an overlapping saved board instead of rendering cards on top of each other", () => {
    const broken = [item("a", 0, 0, 6, 3), item("b", 2, 1, 6, 3)];
    expect(layoutHasOverlap(broken)).toBe(true);
    expectHealthy(compactLayout(broken));
  });

  it("is idempotent", () => {
    const once = compactLayout(board());
    expect(compactLayout(once)).toEqual(once);
  });

  it("settles the shipped default layout without moving anything", () => {
    const next = compactLayout(DEFAULT_DASHBOARD_LAYOUT);
    expectHealthy(next);
    expect(next.map((entry) => `${entry.x},${entry.y}`)).toEqual(
      DEFAULT_DASHBOARD_LAYOUT.map((entry) => `${entry.x},${entry.y}`),
    );
  });
});

describe("nudgeItem", () => {
  it("shifts one column right and one column left", () => {
    const start = compactLayout(board());
    const right = nudgeItem(start, "right", "left", DASHBOARD_COLUMNS);
    expect(right.find((entry) => entry.i === "right")!.x).toBe(7);
    expectHealthy(right);
  });

  it("refuses to push a widget off either edge", () => {
    const start = compactLayout(board());
    expect(nudgeItem(start, "left", "left")).toEqual(start);
    expect(nudgeItem(start, "right", "right")).toEqual(start);
  });

  it("swaps with the widget stacked above", () => {
    const stacked = compactLayout([item("a", 0, 0, 12, 3), item("b", 0, 3, 12, 3)]);
    const next = nudgeItem(stacked, "b", "up");
    expect(next.find((entry) => entry.i === "b")!.y).toBe(0);
    expect(next.find((entry) => entry.i === "a")!.y).toBe(3);
    expectHealthy(next);
  });

  it("swaps with the widget stacked below", () => {
    const stacked = compactLayout([item("a", 0, 0, 12, 3), item("b", 0, 3, 12, 3)]);
    const next = nudgeItem(stacked, "a", "down");
    expect(next.find((entry) => entry.i === "a")!.y).toBe(3);
    expect(next.find((entry) => entry.i === "b")!.y).toBe(0);
  });

  it("swaps with a neighbour that starts in a different column", () => {
    // No positional tie exists between these two, so the swap has to name the
    // neighbour explicitly rather than rely on the row/column sort.
    const offset = compactLayout([
      { i: "hero", type: "next_match", x: 0, y: 0, w: 12, h: 4 },
      { i: "a", type: "alerts", x: 1, y: 4, w: 4, h: 3 },
      { i: "b", type: "recent_result", x: 4, y: 7, w: 4, h: 3 },
    ]);
    expect(offset.find((entry) => entry.i === "a")!.y).toBe(4);

    const down = nudgeItem(offset, "a", "down");
    expect(down.find((entry) => entry.i === "a")!.y).toBeGreaterThan(4);
    expect(down.find((entry) => entry.i === "b")!.y).toBe(4);
    expectHealthy(down);

    const backUp = nudgeItem(down, "a", "up");
    expect(backUp.find((entry) => entry.i === "a")!.y).toBe(4);
    expectHealthy(backUp);
  });

  it("is a no-op at the top and bottom of a column", () => {
    const stacked = compactLayout([item("a", 0, 0, 12, 3), item("b", 0, 3, 12, 3)]);
    expect(nudgeItem(stacked, "a", "up")).toEqual(stacked);
    expect(nudgeItem(stacked, "b", "down")).toEqual(stacked);
  });

  it("reorders a one-column phone board in either direction", () => {
    const phone = compactLayout([item("a", 0, 0, 1, 2), item("b", 0, 2, 1, 2), item("c", 0, 4, 1, 2)], 1);
    const down = nudgeItem(phone, "a", "down", 1);
    expect(layoutOrder(down)).toEqual(["b", "a", "c"]);
    const backUp = nudgeItem(down, "a", "up", 1);
    expect(layoutOrder(backUp)).toEqual(["a", "b", "c"]);
    expectHealthy(down, 1);
  });

  it("holds every invariant across a long random walk", () => {
    let current = compactLayout(board());
    const directions = ["left", "right", "up", "down"] as const;
    const ids = ["hero", "left", "mid", "right"];
    let seed = 7;
    for (let step = 0; step < 240; step += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const id = ids[seed % ids.length]!;
      const direction = directions[Math.floor(seed / 7) % directions.length]!;
      current = nudgeItem(current, id, direction);
      expectHealthy(current);
      expect(current).toHaveLength(4);
    }
  });

  it("ignores an unknown id", () => {
    const start = compactLayout(board());
    expect(nudgeItem(start, "nope", "up")).toEqual(start);
  });
});

describe("reorderLayout", () => {
  it("re-flows the saved board to a new top-to-bottom order", () => {
    const start = compactLayout(board());
    const next = reorderLayout(start, ["right", "hero", "left", "mid"]);
    expect(layoutOrder(next)[0]).toBe("right");
    expectHealthy(next);
  });

  it("keeps each widget's saved width so a phone drag does not flatten the board", () => {
    const start = compactLayout(board());
    const next = reorderLayout(start, ["mid", "left", "right", "hero"]);
    for (const before of start) {
      expect(next.find((entry) => entry.i === before.i)!.w).toBe(before.w);
    }
  });

  it("keeps widgets missing from the order list on the board", () => {
    const start = compactLayout(board());
    const next = reorderLayout(start, ["mid"]);
    expect(next).toHaveLength(start.length);
    expectHealthy(next);
  });
});

describe("gesture helpers", () => {
  it("treats a small wobble as a press and a real slide as a scroll", () => {
    expect(exceedsDragCancelDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(false);
    expect(exceedsDragCancelDistance({ x: 0, y: 0 }, { x: 0, y: 24 })).toBe(true);
    expect(exceedsDragCancelDistance({ x: 0, y: 0 }, { x: 0, y: 8 }, 6)).toBe(true);
  });

  it("auto-scrolls only near the viewport edges", () => {
    expect(edgeAutoScrollDelta(400, 800)).toBe(0);
    expect(edgeAutoScrollDelta(10, 800)).toBeLessThan(0);
    expect(edgeAutoScrollDelta(795, 800)).toBeGreaterThan(0);
  });

  it("scrolls faster the closer the finger gets to the edge", () => {
    expect(Math.abs(edgeAutoScrollDelta(4, 800))).toBeGreaterThan(Math.abs(edgeAutoScrollDelta(80, 800)));
  });

  it("stays still when the viewport is unknown", () => {
    expect(edgeAutoScrollDelta(Number.NaN, 800)).toBe(0);
    expect(edgeAutoScrollDelta(100, 0)).toBe(0);
  });

  it("announces a move in human row/column numbers", () => {
    expect(describeCellMove("Next match", { col: 0, row: 1 })).toBe(
      "Next match moved to row 2, column 1",
    );
  });
});
