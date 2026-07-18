import { describe, expect, it } from "vitest";
import { buildEventFocus } from "./event-focus";
import type { MyDayView } from "./my-day";

function readyView(syncedAt: string | null = "2026-07-18T15:55:00.000Z"): MyDayView {
  return {
    status: "ready",
    context: { orgId: "org-1", orgName: "Vantage Robotics", teamNumber: 9999, role: "member", eventKey: "2026test", eventName: "Test Regional" },
    teamKey: "frc9999",
    next: {
      matchKey: "2026test_qm12", compLevel: "qm", matchLabel: "Qualification 12", matchNumber: 12,
      scheduledTime: "2026-07-18T16:10:00.000Z", timeLabel: "12:10 PM", alliance: "blue",
      bumperCue: "Switch to BLUE bumpers", partners: ["111", "222"], opponents: ["333", "444", "555"],
      partnerKeys: ["frc111", "frc222"], opponentKeys: ["frc333", "frc444", "frc555"],
      scored: false, redScore: null, blueScore: null, isNext: true,
      links: { command: "/command?orgId=org-1", briefing: "/briefing?orgId=org-1&matchKey=2026test_qm12", checklist: "/match-checklist?orgId=org-1", schedule: "/schedule?orgId=org-1", scoutPartners: [], scoutOpponents: [] },
    },
    matches: [],
    freshness: { syncedAt, label: syncedAt ? "Synced 5m ago" : "Schedule not synced yet", matchCount: 40, ourMatchCount: 8 },
    emptyReason: null,
  };
}

describe("buildEventFocus", () => {
  it("creates direct cross-module handoffs for the next match", () => {
    const focus = buildEventFocus(readyView(), true, Date.parse("2026-07-18T16:00:00.000Z"));
    expect(focus).toMatchObject({ id: "2026test_qm12", tone: "live", title: "Next · Qualification 12", detail: "Switch to BLUE bumpers · 12:10 PM" });
    expect(focus?.actions.map((action) => action.label)).toEqual(["Brief", "Checklist", "Command"]);
  });

  it("makes offline and stale evidence explicit", () => {
    expect(buildEventFocus(readyView(), false)?.tone).toBe("offline");
    expect(buildEventFocus(readyView(null), true)?.tone).toBe("stale");
  });

  it("stays hidden until a real next match exists", () => {
    const view = readyView();
    if (view.status === "ready") view.next = null;
    expect(buildEventFocus(view, true)).toBeNull();
    expect(buildEventFocus(null, true)).toBeNull();
  });
});
