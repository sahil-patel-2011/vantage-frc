import { describe, expect, it } from "vitest";
import { profilesFromScouting } from "@vantage/prediction-strategy";
import { completePhaseBreakdown, phasePointValue, phaseSampleCount, pointValue } from "./scouting-points-display";
import { allianceMath } from "./compare-alliance";

describe("recorded scouting presentation", () => {
  it("keeps recorded zero distinct from an unrecorded phase", () => {
    const [profile] = profilesFromScouting([{ teamKey: "frc1678", matchKey: "qm11", total: 12, auto: 0, disabled: true }]);
    expect(phasePointValue(profile!, "auto")).toBe(0);
    expect(phaseSampleCount(profile!, "auto")).toBe(1);
    expect(phasePointValue(profile!, "teleop")).toBeNull();
    expect(pointValue(phasePointValue(profile!, "teleop"))).toBe("Unknown");
    expect(completePhaseBreakdown(profile!)).toBe(false);
  });

  it("refuses phase shares and roles when totals have no complete split", () => {
    const profiles = profilesFromScouting([
      { teamKey: "frc1", matchKey: "qm1", total: 12, auto: 10 },
      { teamKey: "frc2", matchKey: "qm1", total: 20, auto: 0 },
    ]);
    const alliance = allianceMath(profiles);
    expect(alliance?.teleop).toBeNull();
    expect(alliance?.complementarity).toBeNull();
    expect(alliance?.note).toContain("phase split is missing");
  });

  it("permits a complete split only over matching samples and a consistent total", () => {
    const [profile] = profilesFromScouting([{ teamKey: "frc1", matchKey: "qm1", auto: 3, teleop: 6, endgame: 0 }]);
    expect(completePhaseBreakdown(profile!)).toBe(true);
    expect(completePhaseBreakdown({ ...profile!, meanTotal: 15 })).toBe(false);
  });
});
