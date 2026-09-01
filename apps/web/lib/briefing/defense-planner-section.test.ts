import { describe, expect, it } from "vitest";
import { selectBriefingDefensePlans, type DefensePlannerMatchupRow } from "./defense-planner-section";

function row(overrides: Partial<DefensePlannerMatchupRow> = {}): DefensePlannerMatchupRow {
  return {
    opponentTeamNumber: 254,
    opponentTeamName: "Cheesy Poofs",
    recommendation: "play_defense",
    assignedDefender: "us",
    confidence: 0.72,
    rationale: "Their cycle is slow enough to deny.",
    computedAt: "2026-03-14T12:00:00.000Z",
    ...overrides,
  };
}

describe("selectBriefingDefensePlans", () => {
  it("returns nothing when the org has no defense plans", () => {
    expect(selectBriefingDefensePlans([], [254, 118])).toEqual([]);
  });

  it("includes only opponents in this match, in lineup order", () => {
    const plans = selectBriefingDefensePlans(
      [
        row({ opponentTeamNumber: 1678, opponentTeamName: "Citrus" }),
        row({ opponentTeamNumber: 254 }),
        row({ opponentTeamNumber: 9999, recommendation: "stay_offense" }),
      ],
      [254, 1678],
    );
    expect(plans.map((plan) => plan.opponentTeamNumber)).toEqual([254, 1678]);
  });

  it("keeps the newest plan per opponent (callers pass newest first)", () => {
    const plans = selectBriefingDefensePlans(
      [
        row({ recommendation: "stay_offense", computedAt: "2026-03-15T00:00:00.000Z", rationale: "new" }),
        row({ recommendation: "play_defense", computedAt: "2026-03-01T00:00:00.000Z", rationale: "old" }),
      ],
      [254],
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]!.recommendation).toBe("stay_offense");
    expect(plans[0]!.rationale).toBe("new");
  });

  it("drops unknown recommendations instead of inventing advice", () => {
    expect(
      selectBriefingDefensePlans(
        [row({ recommendation: "crush_them" }), row({ recommendation: "situational", rationale: "  maybe  " })],
        [254],
      ),
    ).toEqual([
      {
        opponentTeamNumber: 254,
        opponentTeamName: "Cheesy Poofs",
        recommendation: "situational",
        assignedDefender: "us",
        confidence: 0.72,
        rationale: "maybe",
        computedAt: "2026-03-14T12:00:00.000Z",
      },
    ]);
  });

  it("clamps confidence and defaults a bad defender assignment", () => {
    const plans = selectBriefingDefensePlans(
      [row({ confidence: 4, assignedDefender: "partner" })],
      [254],
    );
    expect(plans[0]!.confidence).toBe(1);
    expect(plans[0]!.assignedDefender).toBe("situational");
  });
});
