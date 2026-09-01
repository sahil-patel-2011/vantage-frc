import { describe, expect, it } from "vitest";
import { AUTO_COORDINATION_CUE, AUTO_FLEXIBILITY_CUE, DEPLOY_SAFETY_CUE } from ".";
import {
  briefingCuesFromText,
  briefingPayloadFromCard,
  toBriefingMatchCardPayload,
} from "./briefing-payload";
import type { MatchStrategyCard } from "./types";

function card(overrides: Partial<MatchStrategyCard> = {}): MatchStrategyCard {
  return {
    id: "2026casj_qm12",
    matchKey: "2026casj_qm12",
    compLevel: "qm",
    matchNumber: 12,
    setNumber: 1,
    eventKey: "2026casj",
    scheduledAt: "2026-03-14T18:00:00.000Z",
    alliances: [
      { color: "red", teamNumbers: [118, 254, 1114], isOwnAlliance: true },
      { color: "blue", teamNumbers: [33, 971, 2056], isOwnAlliance: false },
    ],
    ownAllianceColor: "red",
    gamePlan: null,
    autoAssignment: null,
    defenseFocus: null,
    keyThreats: null,
    driverNotes: null,
    roleAssignments: [],
    hasCard: false,
    isNextMatch: true,
    updatedAt: null,
    ...overrides,
  };
}

describe("toBriefingMatchCardPayload", () => {
  it("maps authored fields without inventing a game plan", () => {
    const payload = toBriefingMatchCardPayload({
      matchKey: "2026casj_qm12",
      partnerNumbers: [118, 1114],
      gamePlan: "  Cycle mid  ",
      autoAssignment: "3-piece left with backup center",
      defenseFocus: "971",
      keyThreats: "fast cycles",
      driverNotes: "stow hood for trench",
      roleAssignments: [{ role: " Driver ", assignee: " Alex " }],
      updatedAt: "2026-03-10T00:00:00.000Z",
      hasCard: true,
    });
    expect(payload).toMatchObject({
      matchKey: "2026casj_qm12",
      hasCard: true,
      gamePlan: "Cycle mid",
      autoAssignment: "3-piece left with backup center",
      defenseFocus: "971",
      keyThreats: "fast cycles",
      driverNotes: "stow hood for trench",
      roleAssignments: [{ role: "Driver", assignee: "Alex" }],
      updatedAt: "2026-03-10T00:00:00.000Z",
    });
    expect(payload.cues).toEqual({ auto: null, backup: null, deploy: null });
    expect(JSON.stringify(payload)).not.toMatch(/DEMO/i);
  });

  it("keeps empty authored fields empty so briefing can show an honest gap", () => {
    const payload = toBriefingMatchCardPayload({
      matchKey: "2026casj_qm12",
      partnerNumbers: [],
    });
    expect(payload.hasCard).toBe(false);
    expect(payload.gamePlan).toBeNull();
    expect(payload.autoAssignment).toBeNull();
    expect(payload.cues).toEqual({ auto: null, backup: null, deploy: null });
  });

  it("emits auto / backup / deploy cues from written text only", () => {
    expect(
      briefingCuesFromText({ partnerNumbers: [118], autoAssignment: null, gamePlan: null }),
    ).toEqual({ auto: AUTO_COORDINATION_CUE, backup: null, deploy: null });
    expect(
      briefingCuesFromText({
        partnerNumbers: [118],
        autoAssignment: "3-piece left",
        gamePlan: "Keep hood deployed",
      }),
    ).toEqual({ auto: null, backup: AUTO_FLEXIBILITY_CUE, deploy: DEPLOY_SAFETY_CUE });
    expect(
      briefingCuesFromText({
        partnerNumbers: [118],
        autoAssignment: "left with backup",
        gamePlan: "Deploy hood, stow for trench",
      }),
    ).toEqual({ auto: null, backup: null, deploy: null });
  });

  it("builds the payload from a persisted next-match card", () => {
    const payload = briefingPayloadFromCard(
      card({
        hasCard: true,
        autoAssignment: "3-piece left",
        gamePlan: "Raise hopper",
      }),
      254,
    );
    expect(payload.matchKey).toBe("2026casj_qm12");
    expect(payload.cues.auto).toBeNull();
    expect(payload.cues.backup).toBe(AUTO_FLEXIBILITY_CUE);
    expect(payload.cues.deploy).toBe(DEPLOY_SAFETY_CUE);
  });
});
