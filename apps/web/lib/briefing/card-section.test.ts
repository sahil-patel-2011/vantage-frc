import { describe, expect, it } from "vitest";
import {
  AUTO_COORDINATION_CUE,
  AUTO_FLEXIBILITY_CUE,
  DEPLOY_SAFETY_CUE,
} from "../match-strategy-cards";
import { EMPTY_BRIEFING_CARD_CUES } from "./card-cues";
import { selectBriefingCard, type MatchStrategyCardRow } from "./card-section";

function row(overrides: Partial<MatchStrategyCardRow> = {}): MatchStrategyCardRow {
  return {
    gamePlan: "Hold the midline, then climb at T-30.",
    autoAssignment: "L4 coral, leave the barge",
    defenseFocus: "Pin 254 off the feeder",
    keyThreats: "254 auto",
    driverNotes: "Battery 7",
    roleAssignments: [{ role: "Driver", assignee: "Alex" }],
    updatedAt: "2026-03-14T12:00:00.000Z",
    ...overrides,
  };
}

describe("selectBriefingCard", () => {
  it("returns nothing when the org has not authored a card", () => {
    expect(selectBriefingCard(null)).toBeNull();
    expect(selectBriefingCard(undefined)).toBeNull();
  });

  it("includes a stored card when any authored field has text", () => {
    const card = selectBriefingCard(row());
    expect(card).not.toBeNull();
    expect(card!.gamePlan).toBe("Hold the midline, then climb at T-30.");
    expect(card!.roleAssignments).toEqual([{ role: "Driver", assignee: "Alex" }]);
  });

  it("treats a blank stored row as empty — never fills from TBA and never attaches cues", () => {
    expect(
      selectBriefingCard(
        row({
          gamePlan: "   ",
          autoAssignment: "",
          defenseFocus: null,
          keyThreats: null,
          driverNotes: "  ",
          roleAssignments: [],
        }),
        { partnerNumbers: [118, 1114] },
      ),
    ).toBeNull();
  });

  it("keeps a card that only has role assignments", () => {
    const card = selectBriefingCard(
      row({
        gamePlan: "",
        autoAssignment: null,
        defenseFocus: null,
        keyThreats: null,
        driverNotes: null,
        roleAssignments: [{ role: "Coach", assignee: "Sam" }],
      }),
    );
    expect(card?.roleAssignments).toEqual([{ role: "Coach", assignee: "Sam" }]);
    expect(card?.cues).toEqual(EMPTY_BRIEFING_CARD_CUES);
  });

  it("drops malformed role rows instead of inventing assignees", () => {
    const card = selectBriefingCard(
      row({
        gamePlan: "Score",
        roleAssignments: ["nope", { role: "", assignee: "" }, { role: "Scout", assignee: "  Jo  " }],
      }),
    );
    expect(card!.roleAssignments).toEqual([{ role: "Scout", assignee: "Jo" }]);
  });

  it("attaches backup / deploy cues from written Auto and game-plan text", () => {
    const card = selectBriefingCard(
      row({
        gamePlan: "Keep hood deployed",
        autoAssignment: "3-piece left",
        defenseFocus: null,
        keyThreats: null,
        driverNotes: null,
        roleAssignments: [],
      }),
    );
    expect(card!.cues).toEqual({
      auto: null,
      backup: AUTO_FLEXIBILITY_CUE,
      deploy: DEPLOY_SAFETY_CUE,
    });
    expect(JSON.stringify(card)).not.toMatch(/DEMO/i);
  });

  it("attaches auto coordination when a written card still lacks Auto and has TBA partners", () => {
    const card = selectBriefingCard(
      row({
        gamePlan: "Hold the midline",
        autoAssignment: "  ",
        defenseFocus: null,
        keyThreats: null,
        driverNotes: null,
        roleAssignments: [],
      }),
      { partnerNumbers: [118] },
    );
    expect(card!.cues.auto).toBe(AUTO_COORDINATION_CUE);
    expect(card!.cues.backup).toBeNull();
  });
});
