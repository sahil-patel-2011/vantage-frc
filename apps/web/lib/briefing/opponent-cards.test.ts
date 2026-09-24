import { describe, expect, it } from "vitest";
import { buildOpponentCards } from "./opponent-cards";
import type { BriefingScoutedTeam } from "./types";

const scouted = (teamKey: string, over: Partial<BriefingScoutedTeam> = {}): BriefingScoutedTeam => ({
  teamKey,
  scoutSample: 7,
  autoCapability: null,
  teleopCapability: null,
  endgameCapability: null,
  defenseLikely: null,
  foulRate: null,
  pitNotes: [],
  ...over,
});

const empty = { opponentTeams: [], scouted: [], tendencies: [], watchNotes: [], counterBooks: [], defensePlans: [] };

describe("opponent cards", () => {
  it("writes plain lines and a likely plan from scouting", () => {
    const [card] = buildOpponentCards({
      ...empty,
      opponentKeys: ["frc1678"],
      opponentTeams: [{ teamKey: "frc1678", teamNumber: 1678, nickname: "Citrus", epaTotal: 57.5, rank: 3 } as never],
      scouted: [scouted("frc1678", { autoCapability: 0.86, teleopCapability: 1, endgameCapability: 0.61, foulRate: 1.7 })],
      tendencies: [{ teamKey: "frc1678", labels: ["foul-prone"], evidence: ["Scout reliability 89% (n=7.6)."] }],
    });
    expect(card!.team).toBe("1678");
    expect(card!.standing).toBe("Ranked 3 · rating 57.5");
    expect(card!.lines).toEqual(["Strong scorer in auto and teleop", "Usually does the endgame", "~1.7 fouls a match"]);
    expect(card!.likelyPlan).toBe("Likely plan: cycles");
    // The statistics move to "How we got this", off the card.
    expect(card!.lines.join(" ")).not.toMatch(/n=|reliability/);
    expect(card!.evidence.join(" ")).toMatch(/Scout reliability 89%/);
  });

  it("says a team may defend when scouting saw it", () => {
    const [card] = buildOpponentCards({
      ...empty,
      opponentKeys: ["frc254"],
      scouted: [scouted("frc254", { teleopCapability: 0.8, defenseLikely: true })],
    });
    expect(card!.likelyPlan).toBe("Likely plan: cycles, may defend");
    expect(card!.lines).toContain("Plays defense");
  });

  it("invents nothing for an unscouted opponent", () => {
    const [card] = buildOpponentCards({ ...empty, opponentKeys: ["frc9999"] });
    expect(card).toMatchObject({ team: "9999", lines: [], likelyPlan: null, standing: null, scoutSample: 0 });
  });

  it("carries the team's own notes and plans", () => {
    const [card] = buildOpponentCards({
      ...empty,
      opponentKeys: ["frc118"],
      watchNotes: [{ teamKey: "frc118", teamNumber: 118, note: "Fast climber", createdAt: "" }],
      defensePlans: [
        {
          opponentTeamNumber: 118,
          opponentTeamName: "Robonauts",
          recommendation: "play_defense",
          assignedDefender: "us",
          confidence: 0.7,
          rationale: "",
          computedAt: "",
        },
      ],
    });
    expect(card!.notes).toEqual(["Our note: Fast climber", "Defense plan: play defense on them (we defend)"]);
  });
});
