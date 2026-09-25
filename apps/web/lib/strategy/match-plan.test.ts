import { describe, expect, it } from "vitest";
import type { WinLever } from "@vantage/prediction-strategy";
import { matchSpecificPlan } from "./match-plan";

const lever = (over: Partial<WinLever>): WinLever => ({
  id: "defend-top-opponent",
  title: "Defend 118",
  detail: "118 is 43% of the opposing alliance. Holding them to half swings this match.",
  ratingGain: 10,
  probabilityAfter: 0.85,
  gain: 10.1,
  isCeiling: false,
  ...over,
});

describe("matchSpecificPlan", () => {
  it("leads with the measured levers and names the partner who broke down", () => {
    const plan = matchSpecificPlan({
      levers: [
        lever({}),
        lever({ id: "penalties", title: "Play a clean match", detail: "Scouting has you at 2 penalty points per match.", gain: 1.3, ratingGain: 1.5 }),
        lever({ id: "scoring-rate", title: "What ten more points is worth", ratingGain: 10, gain: 6.5 }),
      ],
      ourTeamKey: "frc6925",
      partners: ["frc1323", "frc7457"],
      opponents: ["frc118", "frc2481", "frc3005"],
      operations: [
        { teamKey: "frc7457", scoutSample: 4, reliability: 75 },
        { teamKey: "frc6925", scoutSample: 4, foulRate: 2 },
        { teamKey: "frc118", scoutSample: 5, endgameCapability: 0.76 },
      ],
    });
    expect(plan[0]).toBe("Defend 118: 118 is 43% of the opposing alliance (+10.1% win chance)");
    expect(plan[1]).toMatch(/^Play a clean match: scouting has you at 2 penalty points per match/);
    expect(plan).toContain("7457 broke down in 25% of the matches we scouted: plan to win if they stop.");
    // The penalties lever already covers fouls; the exchange-rate lever is not a step.
    expect(plan.join(" ")).not.toMatch(/Keep fouls down|ten more points/);
    expect(plan.length).toBeLessThanOrEqual(4);
  });

  it("says nothing when nothing was measured, so the general tips stay", () => {
    expect(
      matchSpecificPlan({ levers: [], ourTeamKey: "frc1", partners: ["frc2"], opponents: ["frc3"], operations: [] }),
    ).toEqual([]);
  });
});
