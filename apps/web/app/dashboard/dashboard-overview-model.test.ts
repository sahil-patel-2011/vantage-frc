import { describe, expect, it } from "vitest";
import { homeActivities, homeTasks, liveCount, scoutingHomeAction } from "./dashboard-overview-model";
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
  it("keeps an ongoing practice visible until its recorded end", () => {
    const now = new Date("2026-10-02T16:00:00Z");
    const items = homeActivities(live({ items: [
      { title: "Practice", startsAt: "2026-10-02T15:00:00Z", endsAt: "2026-10-02T17:00:00Z" },
      { title: "Finished", startsAt: "2026-10-02T14:00:00Z", endsAt: "2026-10-02T15:00:00Z" },
    ] }), undefined, now);
    expect(items.map(item => [item.title, item.ongoing])).toEqual([["Practice", true]]);
  });
  it("shows only real open tasks, preserving missing dates and assignees", () => {
    const data = live({ items: [
      { id: "one", title: "Fix intake", status: "doing", dueOn: "2026-10-01", assigneeName: "Scout" },
      { id: "two", title: "Pack tools", status: "todo", dueOn: "bad" },
      { id: "done", title: "Done task", status: "done" }, null,
    ] });
    const tasks = homeTasks(data, new Date(2026, 9, 2));
    expect(tasks.map(item => item.id)).toEqual(["one", "two"]);
    expect(tasks[0]?.overdue).toBe(true);
    expect(tasks[1]).toMatchObject({ dueOn: null, assigneeName: null, overdue: false });
    expect(homeTasks({ ...data, status: "setup_required" })).toEqual([]);
  });
});
