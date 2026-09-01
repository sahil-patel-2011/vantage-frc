import { describe, expect, it } from "vitest";
import type { MyDayMatch, MyDayView } from "../my-day";
import {
  MY_DAY_POLL_MS,
  MY_DAY_POLL_WIDGETS,
  mergeMyDayView,
  myDayPollWidgetTypes,
  shouldPollMyDay,
} from "./poll";

const NEXT: MyDayMatch = {
  matchKey: "2026casd_qm12",
  compLevel: "qm",
  matchLabel: "Qual 12",
  matchNumber: 12,
  scheduledTime: "2026-03-14T16:30:00.000Z",
  timeLabel: "Sat 9:30 AM",
  alliance: "red",
  bumperCue: "Switch to RED bumpers",
  partners: ["254"],
  opponents: ["118"],
  partnerKeys: ["frc254"],
  opponentKeys: ["frc118"],
  scored: false,
  redScore: null,
  blueScore: null,
  isNext: true,
  links: {
    command: "/command?orgId=org-1",
    briefing: "/briefing?orgId=org-1",
    checklist: "/match-checklist?orgId=org-1",
    schedule: "/schedule?orgId=org-1",
    scoutPartners: [],
    scoutOpponents: [],
  },
};

function ready(overrides: Partial<Extract<MyDayView, { status: "ready" }>> = {}): MyDayView {
  return {
    status: "ready",
    context: {
      orgId: "org-1",
      orgName: "Citrus",
      teamNumber: 1678,
      role: "member",
      eventKey: "2026casd",
      eventName: "San Diego Regional",
    },
    teamKey: "frc1678",
    next: NEXT,
    matches: [NEXT],
    freshness: {
      syncedAt: "2026-03-14T16:00:00.000Z",
      label: "Synced 12m ago",
      matchCount: 80,
      ourMatchCount: 1,
    },
    logistics: {
      lodging: null,
      nextTravel: null,
      onDuty: null,
      checklistPercent: 40,
    },
    emptyReason: null,
    ...overrides,
  };
}

describe("MY_DAY_POLL_MS", () => {
  it("matches Event Day Command cadence", () => {
    expect(MY_DAY_POLL_MS).toBe(20_000);
  });
});

describe("shouldPollMyDay", () => {
  it("pauses while the tab is hidden", () => {
    expect(shouldPollMyDay("hidden")).toBe(false);
    expect(shouldPollMyDay("visible")).toBe(true);
    // SSR / older engines without visibilityState default to polling.
    expect(shouldPollMyDay(undefined)).toBe(true);
    expect(shouldPollMyDay(null)).toBe(true);
    expect(shouldPollMyDay("hidden", false)).toBe(true);
  });
});

describe("myDayPollWidgetTypes", () => {
  it("always refreshes next_match and bumpers from the TBA cache", () => {
    expect(MY_DAY_POLL_WIDGETS).toEqual(["next_match", "bumpers"]);
    for (const shell of ["loading", "error", "setup", "empty", "ready"] as const) {
      expect(myDayPollWidgetTypes({ shell })).toEqual(["next_match", "bumpers"]);
    }
  });
});

describe("mergeMyDayView", () => {
  it("overlays next match / bumpers without dropping last-good logistics", () => {
    const current = ready();
    const incoming = ready({
      next: {
        ...NEXT,
        matchKey: "2026casd_qm18",
        matchLabel: "Qual 18",
        matchNumber: 18,
        scheduledTime: "2026-03-14T18:00:00.000Z",
        timeLabel: "Sat 11:00 AM",
        alliance: "blue",
        bumperCue: "Switch to BLUE bumpers",
      },
      logistics: undefined,
    });
    const merged = mergeMyDayView(current, incoming);
    expect(merged.status).toBe("ready");
    if (merged.status !== "ready") return;
    expect(merged.next?.matchKey).toBe("2026casd_qm18");
    expect(merged.next?.bumperCue).toBe("Switch to BLUE bumpers");
    expect(merged.next?.scheduledTime).toBe("2026-03-14T18:00:00.000Z");
    expect(merged.logistics?.checklistPercent).toBe(40);
    expect(JSON.stringify(merged)).not.toMatch(/DEMO/i);
  });

  it("does not invent a DEMO clock when TBA has no scheduled time", () => {
    const incoming = ready({
      next: {
        ...NEXT,
        scheduledTime: null,
        timeLabel: "Time TBD",
      },
    });
    const merged = mergeMyDayView(ready(), incoming);
    expect(merged.status).toBe("ready");
    if (merged.status !== "ready") return;
    expect(merged.next?.scheduledTime).toBeNull();
    expect(merged.next?.timeLabel).toBe("Time TBD");
    expect(merged.next?.timeLabel).not.toMatch(/DEMO/i);
  });

  it("replaces a live view when setup is required", () => {
    const incoming: MyDayView = {
      status: "setup_required",
      context: {
        orgId: "org-1",
        orgName: "Citrus",
        teamNumber: 1678,
        role: "member",
        eventKey: null,
        eventName: null,
      },
      message: "Select an active event to load your match queue.",
    };
    expect(mergeMyDayView(ready(), incoming)).toEqual(incoming);
  });
});
