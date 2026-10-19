import { describe, expect, it } from "vitest";
import { allianceResultsFromMatches, eventScoringFrom } from "./alliance-results";

describe("allianceResultsFromMatches", () => {
  it("takes fouls handed over out of the score and reads the phase split when it is there", () => {
    const rows = allianceResultsFromMatches([
      {
        matchKey: "2026x_qm1",
        matchNumber: 1,
        redAlliance: { score: 104, teamKeys: ["frc1", "frc2", "frc3"] },
        blueAlliance: { score: 90, teamKeys: ["frc4", "frc5", "frc6"] },
        scoreBreakdown: {
          red: { foulPoints: 6, autoPoints: 20, teleopPoints: 60, endGameBargePoints: 18 },
          blue: { foulPoints: 0 },
        },
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ total: 98, auto: 20, teleop: 60, endgame: 18, order: 1 });
    expect(rows[1]).toMatchObject({ total: 90, auto: null, endgame: null });
  });

  it("skips unplayed (-1) and malformed alliances", () => {
    expect(
      allianceResultsFromMatches([
        { matchKey: "q", matchNumber: 2, redAlliance: { score: -1, teamKeys: ["frc1"] }, blueAlliance: null, scoreBreakdown: null },
      ]),
    ).toEqual([]);
  });
});

describe("eventScoringFrom", () => {
  const alliance = (matchKey: string, order: number, teamKeys: string[], total: number) => ({ matchKey, order, teamKeys, total });

  it("rates every robot that has played and reports the event's average alliance score", () => {
    const scoring = eventScoringFrom([
      alliance("qm1", 1, ["frc1", "frc2", "frc3"], 90),
      alliance("qm1", 1, ["frc4", "frc5", "frc6"], 30),
      alliance("qm2", 2, ["frc1", "frc4", "frc5"], 70),
      alliance("qm2", 2, ["frc2", "frc3", "frc6"], 50),
    ]);
    expect(scoring.alliances).toBe(4);
    expect(scoring.averageAllianceScore).toBe(60);
    // From a robot's first match: six robots, two matches each.
    expect(scoring.opr.map((robot) => robot.teamKey).sort()).toEqual(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]);
    const byTeam = new Map(scoring.opr.map((robot) => [robot.teamKey, robot.total]));
    expect(byTeam.get("frc1")!).toBeGreaterThan(byTeam.get("frc6")!);
  });

  it("has nothing to say before a match is played", () => {
    expect(eventScoringFrom([])).toEqual({ opr: [], averageAllianceScore: null, alliances: 0 });
  });
});
