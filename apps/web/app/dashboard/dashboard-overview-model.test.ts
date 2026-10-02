import { describe, expect, it } from "vitest";
import { homeActivities, liveCount, scoutingHomeAction } from "./dashboard-overview-model";
import type { WidgetPayload } from "../../lib/dashboard/snapshot";
const live = (data: Record<string, unknown>): WidgetPayload => ({ type: "calendar_today", status: "live", updatedAt: "", data });

describe("the real Home overview", () => {
  it("offers practice without an event, published event forms when ready, and form setup to leaders only", () => {
    const base = { orgId: "org-1", hasEvent: false, hasForms: false, role: "scout" };
    expect(scoutingHomeAction(base).href).toContain("mode=free");
    expect(scoutingHomeAction({ ...base, hasEvent: true, hasForms: true }).label).toBe("Start scouting");
    expect(scoutingHomeAction({ ...base, hasEvent: true, role: "owner" }).href).toContain("tab=forms");
    expect(scoutingHomeAction({ ...base, hasEvent: true }).href).not.toContain("tab=forms");
    expect(scoutingHomeAction({ ...base, role: "viewer" }).href).toContain("tab=teams");
  });
  it("opens a real assignment with the correct robot and team context", () => {
    const action = scoutingHomeAction({ orgId: "org-1", role: "scout", hasEvent: true, hasForms: true,
      duty: { matchKey: "2026test_qm4", teamKey: "frc254", matchLabel: "Qual 4", station: "Red 1" } });
    expect(action.label).toContain("254");
    expect(action.href).toContain("teamKey=frc254");
    expect(action.href).toContain("orgId=org-1");
  });
  it("does not turn missing, invalid, or stale counters into zero", () => {
    expect(liveCount(undefined, "reports")).toBeNull();
    expect(liveCount(live({ reports: null }), "reports")).toBeNull();
    expect(liveCount({ ...live({ reports: 12 }), status: "setup_required" }, "reports")).toBeNull();
    expect(liveCount(live({ reports: 0 }), "reports")).toBe(0);
  });
  it("merges upcoming calendar events and duties, skipping past or invalid dates", () => {
    const items = homeActivities(live({ items: [
      { title: "Past", startsAt: "2026-10-01T08:00:00Z" },
      { title: "Unknown", startsAt: "bad" },
      { title: "Practice", startsAt: "2026-10-01T20:00:00Z" },
    ] }), live({ duties: [{ title: "Load trailer", startsAt: "2026-10-01T18:00:00Z" }] }), new Date("2026-10-01T16:00:00Z"));
    expect(items.map(row => row.title)).toEqual(["Load trailer", "Practice"]);
    expect(items[0]?.duty).toBe(true);
    expect(homeActivities(undefined, undefined)).toEqual([]);
  });
});
