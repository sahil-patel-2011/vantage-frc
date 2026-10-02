import { describe, expect, it } from "vitest";
import { homeViewLayout, type DashboardWidgetLayout } from "./catalog";

describe("explicit Home choices", () => {
  const item: DashboardWidgetLayout = { i: "prediction", type: "prediction_summary", x: 0, y: 0, w: 4, h: 4, config: { alwaysShow: true, fixedSize: true } };
  it("retains a pinned prediction through missing event data and every refresh status", () => {
    for (const status of ["live", "empty", "setup_required", "error", undefined]) {
      expect(homeViewLayout([item], { editing: false, shell: "setup", sharedSetupPrompt: true, homeOverview: true, widgets: { prediction_summary: { status } } })).toEqual([item]);
    }
  });
  it("honors an explicit next-match size even alone and while empty", () => {
    const match = { ...item, type: "next_match" as const };
    expect(homeViewLayout([match], { editing: false, shell: "ready", widgets: { next_match: { status: "empty" } } })).toEqual([match]);
  });
  it("preserves the saved width of previously pinned cards without a new size flag", () => {
    const previous = { ...item, config: { alwaysShow: true } };
    expect(homeViewLayout([previous], { editing: false, shell: "setup", sharedSetupPrompt: true, homeOverview: true, widgets: { prediction_summary: { status: "setup_required" } } })).toEqual([previous]);
  });
});
