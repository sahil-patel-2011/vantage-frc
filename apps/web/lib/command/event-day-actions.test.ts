import { describe, expect, it } from "vitest";
import { eventDayNextActions } from "./event-day-actions";
import type { CommandSnapshot } from "./types";

function baseSnap(overrides: Partial<CommandSnapshot> = {}): CommandSnapshot {
  return {
    status: "live",
    computedAt: new Date().toISOString(),
    orgId: "org-1",
    role: "member",
    canSetEvent: true,
    orgName: "Test",
    teamNumber: 1,
    teamKey: "frc1",
    eventKey: "2026ny",
    eventName: "Test Event",
    tbaConfigured: true,
    setupSteps: [],
    matches: [],
    scoutQueue: [],
    briefs: [],
    pitFlags: [],
    myDay: null,
    nexus: null,
    prediction: {
      status: "empty",
      matchKey: null,
      modelVersion: null,
      pOur: null,
      pOpp: null,
      confidenceLow: null,
      confidenceHigh: null,
      caveats: [],
      keyFactors: [],
      matchup: null,
      playbook: null,
      tendencies: [],
      fullPrediction: null,
    },
    record: {
      status: "empty",
      wins: null,
      losses: null,
      ties: null,
      rank: null,
      epaTotal: null,
      source: null,
      syncedAt: null,
    },
    coverage: {
      matchReports: 0,
      pitReports: 0,
      openDisagreements: 0,
      upcomingUnscouted: 0,
      missingRows: 0,
      assignedWaiting: 0,
      coveredRows: 0,
      doubleCovered: 0,
      liveBoard: [],
      coordinatorNudge: null,
    },
    links: {
      strategy: "/competition?tab=strategy&orgId=org-1",
      scouting: "/competition?tab=scouting&orgId=org-1",
      messages: "/messages?orgId=org-1",
      intel: "/intel?orgId=org-1",
      workspace: "/workspace",
      teamData: "/team/data?orgId=org-1",
      display: "/display?orgId=org-1",
      chemistry: "/competition?tab=chemistry&orgId=org-1",
      pit: "/pit?orgId=org-1",
      batteries: "/batteries?orgId=org-1",
      myDay: "/competition?tab=my-day&orgId=org-1",
      logistics: "/logistics?orgId=org-1",
      schedule: "/schedule?orgId=org-1",
      matchChecklist: "/competition?tab=match-checklist&orgId=org-1",
    },
    ...overrides,
  };
}

describe("eventDayNextActions", () => {
  it("returns workspace-only action without inventing metrics", () => {
    const actions = eventDayNextActions(null);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.every((a) => !/demo/i.test(a.label + a.detail))).toBe(true);
  });

  it("prioritizes event setup when missing", () => {
    const actions = eventDayNextActions(baseSnap({ eventKey: null, eventName: null }));
    expect(actions[0]?.id).toBe("event");
    expect(actions[0]?.primary).toBe(true);
    expect(actions[0]?.label).toMatch(/Set active event/);
  });

  it("surfaces scout gaps when a match is queued without duplicating the related strip", () => {
    const actions = eventDayNextActions(
      baseSnap({
        matches: [
          {
            matchKey: "2026ny_qm1",
            compLevel: "qm",
            matchNumber: 1,
            scheduledTime: "2026-03-01T15:00:00.000Z",
            predictedTime: null,
            ourAlliance: "red",
            red: { teamKeys: ["frc1", "frc2", "frc3"] },
            blue: { teamKeys: ["frc4", "frc5", "frc6"] },
            label: "next",
          },
        ],
        coverage: {
          matchReports: 0,
          pitReports: 0,
          openDisagreements: 0,
          upcomingUnscouted: 2,
          missingRows: 2,
          assignedWaiting: 0,
          coveredRows: 0,
          doubleCovered: 0,
          liveBoard: [],
          coordinatorNudge: null,
        },
        myDay: {
          bumperCue: "Switch to RED bumpers",
          ourAlliance: "red",
          lodgingLabel: null,
          nextTravelLabel: null,
          onDutyLabel: null,
          checklistPercent: null,
          href: "/competition?tab=my-day&orgId=org-1",
        },
      }),
    );
    // Match checklist lives on the Event day related strip, so Next actions
    // must not duplicate it. Scout gaps still belong on the action list.
    expect(actions.find((a) => a.id === "checklist")).toBeUndefined();
    expect(actions.find((a) => a.id === "scout")?.label).toMatch(/2 coverage/);
    expect(
      actions.every((a) => {
        const blob = `${a.label} ${a.detail}`;
        return !/\b(fabricat|illustrative|DEMO)\b/i.test(blob);
      }),
    ).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("/demo"))).toBe(true);
  });
});
