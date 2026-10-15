import { describe, expect, it } from "vitest";
import { pickListCountsLabel } from "../scouting/scouted-counts";
import { pickDeskScoutedCounts } from "./pick-desk";

describe("pick list scouted count", () => {
  it("counts every scouted robot, rated or not, and names the ones the pool cannot list", () => {
    const counts = pickDeskScoutedCounts({
      totals: { robots: 9, robotMatches: 12, reports: 14 },
      scoutedTeamKeys: ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6", "frc7", "frc8", "frc9"],
      ratedTeamKeys: ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6", "frc7", "frc100", "frc101"],
    });
    expect(counts).toEqual({ scoutedTeams: 9, scoutedNotRated: 2 });
    expect(pickListCountsLabel({ teams: 32, scouted: counts.scoutedTeams, scoutedNotRated: counts.scoutedNotRated })).toBe(
      "32 teams · 9 scouted (2 not rated yet)",
    );
  });

  it("falls back to counting the scouted keys when the totals read failed", () => {
    expect(pickDeskScoutedCounts({ totals: null, scoutedTeamKeys: ["frc1", "frc2"], ratedTeamKeys: ["frc1", "frc2"] })).toEqual({
      scoutedTeams: 2,
      scoutedNotRated: 0,
    });
  });
});
