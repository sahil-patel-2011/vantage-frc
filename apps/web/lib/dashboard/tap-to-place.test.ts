import { describe, expect, it } from "vitest";
import { DEFAULT_DASHBOARD_LAYOUT } from "./catalog";
import { placePendingWidget, prefersTapToPlace } from "./tap-to-place";

describe("tap-to-place Home edit", () => {
  it("uses tap-to-place on coarse / touch pointers and drag on mouse", () => {
    expect(prefersTapToPlace({ pointerType: "touch" })).toBe(true);
    expect(prefersTapToPlace({ pointerType: "pen" })).toBe(true);
    expect(prefersTapToPlace({ coarse: true })).toBe(true);
    expect(prefersTapToPlace({ pointerType: "mouse" })).toBe(false);
    expect(prefersTapToPlace({})).toBe(false);
  });

  it("places the pending widget on the tapped slot and refuses an empty pick", () => {
    expect(placePendingWidget(DEFAULT_DASHBOARD_LAYOUT, null, { x: 0, y: 10 })).toEqual({
      ok: false,
      error: "Pick a widget first, then tap a slot on the board.",
    });
    const placed = placePendingWidget(DEFAULT_DASHBOARD_LAYOUT, "notifications", { x: 0, y: 20 }, { now: 7 });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.layout.some((item) => item.type === "notifications")).toBe(true);
    expect(placed.layout.find((item) => item.type === "notifications")?.i).toBe("w-notifications-7");
  });
});
