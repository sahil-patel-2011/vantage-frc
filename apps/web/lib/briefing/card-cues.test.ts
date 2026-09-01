import { describe, expect, it } from "vitest";
import {
  AUTO_COORDINATION_CUE,
  AUTO_FLEXIBILITY_CUE,
  DEPLOY_SAFETY_CUE,
} from "../match-strategy-cards";
import {
  EMPTY_BRIEFING_CARD_CUES,
  briefingCardCuesFromAuthored,
  hasAuthoredBriefingCard,
} from "./card-cues";

describe("hasAuthoredBriefingCard", () => {
  it("is false when every field is blank — never a DEMO card", () => {
    expect(
      hasAuthoredBriefingCard({
        gamePlan: "   ",
        autoAssignment: "",
        defenseFocus: null,
        keyThreats: null,
        driverNotes: "  ",
        roleAssignments: [],
      }),
    ).toBe(false);
  });

  it("is true when any authored field has text", () => {
    expect(hasAuthoredBriefingCard({ gamePlan: "Cycle mid" })).toBe(true);
    expect(hasAuthoredBriefingCard({ roleAssignments: [{ role: "Driver", assignee: "Alex" }] })).toBe(
      true,
    );
  });
});

describe("briefingCardCuesFromAuthored", () => {
  it("returns no cues for an empty card, even when TBA partners exist", () => {
    expect(
      briefingCardCuesFromAuthored({
        partnerNumbers: [118, 1114],
        gamePlan: "  ",
        autoAssignment: null,
        driverNotes: "",
        roleAssignments: [],
      }),
    ).toEqual(EMPTY_BRIEFING_CARD_CUES);
  });

  it("emits backup / deploy from written text only", () => {
    expect(
      briefingCardCuesFromAuthored({
        autoAssignment: "3-piece left",
        gamePlan: "Keep hood deployed",
      }),
    ).toEqual({ auto: null, backup: AUTO_FLEXIBILITY_CUE, deploy: DEPLOY_SAFETY_CUE });
  });

  it("stays quiet when the written text already covers backup and deploy", () => {
    expect(
      briefingCardCuesFromAuthored({
        autoAssignment: "left with backup",
        gamePlan: "Deploy hood, stow for trench",
      }),
    ).toEqual(EMPTY_BRIEFING_CARD_CUES);
  });

  it("emits auto coordination only when a non-empty card still lacks Auto and has real partners", () => {
    expect(
      briefingCardCuesFromAuthored({
        partnerNumbers: [118],
        gamePlan: "Hold the midline",
        autoAssignment: null,
      }),
    ).toEqual({ auto: AUTO_COORDINATION_CUE, backup: null, deploy: null });
    expect(
      briefingCardCuesFromAuthored({
        gamePlan: "Hold the midline",
        autoAssignment: null,
      }),
    ).toEqual(EMPTY_BRIEFING_CARD_CUES);
  });

  it("never invents DEMO strategy copy", () => {
    const cues = briefingCardCuesFromAuthored({
      partnerNumbers: [118],
      autoAssignment: "3-piece left",
      gamePlan: "Raise hopper",
    });
    expect(JSON.stringify(cues)).not.toMatch(/DEMO/i);
    expect(cues.backup).toBe(AUTO_FLEXIBILITY_CUE);
    expect(cues.deploy).toBe(DEPLOY_SAFETY_CUE);
  });
});
