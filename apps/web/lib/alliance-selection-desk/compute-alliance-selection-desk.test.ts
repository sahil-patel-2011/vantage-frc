import { describe, expect, it } from "vitest";
import { detectDeskConflicts, groupSlotsByAlliance, normalizeTeamKey, teamNumberFromKey } from ".";

describe("alliance-selection-desk helpers", () => {
  it("normalizes team keys and numbers", () => {
    expect(normalizeTeamKey("254")).toBe("frc254");
    expect(normalizeTeamKey("frc118")).toBe("frc118");
    expect(normalizeTeamKey("")).toBeNull();
    expect(teamNumberFromKey("frc1678")).toBe(1678);
  });

  it("flags duplicate picks and missing TBA / scout evidence without inventing metrics", () => {
    const flags = detectDeskConflicts({
      eventHasTbaMetrics: true,
      slots: [
        {
          id: "a",
          allianceSeed: 1,
          pickSlot: "captain",
          teamKey: "frc254",
          tbaRank: 1,
          tbaEpa: 60,
          matchScoutCount: 3,
          pitScoutCount: 1,
        },
        {
          id: "b",
          allianceSeed: 2,
          pickSlot: "first",
          teamKey: "frc254",
          tbaRank: 1,
          tbaEpa: 60,
          matchScoutCount: 3,
          pitScoutCount: 1,
        },
        {
          id: "c",
          allianceSeed: 1,
          pickSlot: "first",
          teamKey: "frc9999",
          tbaRank: null,
          tbaEpa: null,
          matchScoutCount: 0,
          pitScoutCount: 0,
        },
      ],
    });
    expect(flags.some((f) => f.code === "duplicate_pick")).toBe(true);
    expect(flags.some((f) => f.code === "missing_tba_metrics")).toBe(true);
    expect(flags.some((f) => f.code === "no_scout_evidence")).toBe(true);
  });

  it("groups slots by alliance seed", () => {
    const groups = groupSlotsByAlliance([
      {
        id: "1",
        allianceSeed: 2,
        pickSlot: "captain",
        teamKey: null,
        teamNumber: null,
        nickname: null,
        rationale: "",
        sortOrder: 0,
        evidence: [],
        matchScoutCount: 0,
        pitScoutCount: 0,
        tbaRank: null,
        tbaEpa: null,
        conflicts: [],
      },
      {
        id: "2",
        allianceSeed: 1,
        pickSlot: "captain",
        teamKey: null,
        teamNumber: null,
        nickname: null,
        rationale: "",
        sortOrder: 0,
        evidence: [],
        matchScoutCount: 0,
        pitScoutCount: 0,
        tbaRank: null,
        tbaEpa: null,
        conflicts: [],
      },
    ]);
    expect(groups.map((g) => g.seed)).toEqual([1, 2]);
  });
});
