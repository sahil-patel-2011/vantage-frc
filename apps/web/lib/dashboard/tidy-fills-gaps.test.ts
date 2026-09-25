import { describe, expect, it } from "vitest";
import { packDashboardLayout, type DashboardWidgetLayout } from "./catalog";
import { tidyBoard } from "./edit-mode";

describe("Snap & tidy after moving a small card first", () => {
  it("pulls the next card that fits into the gap instead of stretching one number across the row", () => {
    const layout = packDashboardLayout([
      { i: "w-hours", type: "hours_month", x: 0, y: 0, w: 4, h: 3 },
      { i: "w-next", type: "next_match", x: 0, y: 3, w: 12, h: 4 },
      { i: "w-day", type: "my_day", x: 0, y: 7, w: 4, h: 3 },
    ] as DashboardWidgetLayout[]);
    const visibleIds = new Set(layout.map((item) => item.i));
    const result = tidyBoard({ layout, visibleIds, displayFor: (board) => packDashboardLayout(board) });
    const at = (id: string) => result.layout.find((item) => item.i === id)!;
    expect(result.moved).toBe(true);
    expect(at("w-day").y).toBe(0);
    expect(at("w-hours").w).toBeLessThanOrEqual(8);
  });
});
