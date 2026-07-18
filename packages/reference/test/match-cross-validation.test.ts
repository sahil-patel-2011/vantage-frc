import { describe, expect, it } from "vitest";
import {
  classifyComparableField,
  extractTbaTeamMatchFacts,
  officialValueFromTbaFacts,
  softStatboticsClimbSignal,
} from "../src/match-cross-validation";

describe("match cross-validation", () => {
  const match = {
    matchKey: "2026test_qm1",
    redAlliance: { teamKeys: ["frc1", "frc2", "frc3"] },
    blueAlliance: { teamKeys: ["frc4", "frc5", "frc6"] },
    scoreBreakdown: {
      red: {
        endGameRobot2: "DeepCage",
        autoLineRobot2: "Yes",
        foulCount: 2,
        techFoulCount: 0,
        foulPoints: 10,
      },
      blue: { endGameRobot1: "None", foulCount: 0 },
    },
  };

  it("classifies climb mobility and foul fields", () => {
    expect(classifyComparableField("endgame")).toBe("climb");
    expect(classifyComparableField("auto_mobility")).toBe("mobility");
    expect(classifyComparableField("foul_count")).toBe("foul");
    expect(classifyComparableField("notes")).toBe("other");
  });

  it("extracts TBA team facts without inventing missing robots", () => {
    const facts = extractTbaTeamMatchFacts(match, "frc2");
    expect(facts).toMatchObject({
      alliance: "red",
      teamIndex: 2,
      climb: "DeepCage",
      climbKey: "endGameRobot2",
      mobility: "Yes",
      mobilityKey: "autoLineRobot2",
      foulCount: 2,
      foulPoints: 10,
    });
    expect(extractTbaTeamMatchFacts({ ...match, scoreBreakdown: null }, "frc2")).toBeNull();
  });

  it("maps scout fields onto official TBA keys", () => {
    const facts = extractTbaTeamMatchFacts(match, "frc2")!;
    expect(
      officialValueFromTbaFacts({
        fieldKey: "climb",
        facts,
        scoreBreakdown: match.scoreBreakdown,
      }),
    ).toEqual({ value: "DeepCage", officialKey: "endGameRobot2", kind: "climb" });
    expect(
      officialValueFromTbaFacts({
        fieldKey: "fouls",
        facts,
        scoreBreakdown: match.scoreBreakdown,
      }),
    ).toEqual({ value: 2, officialKey: "foulCount", kind: "foul" });
  });

  it("emits soft Statbotics notes only from real EPA values", () => {
    expect(softStatboticsClimbSignal({ scoutClimb: "none", epaEndgame: null })).toBeNull();
    expect(softStatboticsClimbSignal({ scoutClimb: "none", epaEndgame: 9 })?.softNote).toMatch(/EPA endgame/);
    expect(softStatboticsClimbSignal({ scoutClimb: "deep", epaEndgame: 9 })?.softNote).toBeNull();
  });
});
