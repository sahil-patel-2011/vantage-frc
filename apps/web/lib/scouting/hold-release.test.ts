import { describe, expect, it } from "vitest";
import { HOLD_TAP_MS, holdReleaseStops } from "./hold-release";

describe("hold-to-record release", () => {
  it("stops after a hold, keeps a tap locked on, and stops a running action on a tap", () => {
    expect(holdReleaseStops({ how: "up", startedHere: true, heldMs: 6_000 })).toBe(true);
    expect(holdReleaseStops({ how: "up", startedHere: true, heldMs: HOLD_TAP_MS - 1 })).toBe(false);
    expect(holdReleaseStops({ how: "up", startedHere: false, heldMs: 50 })).toBe(true);
  });

  it("does not end the action when the browser cancels the press mid-hold", () => {
    // A thumb drifting 10-15 px turned the hold into a scroll; Chrome sent pointercancel.
    expect(holdReleaseStops({ how: "cancel", startedHere: true, heldMs: 2_000 })).toBe(false);
    expect(holdReleaseStops({ how: "cancel", startedHere: false, heldMs: 2_000 })).toBe(false);
  });
});
