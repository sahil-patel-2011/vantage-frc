import { describe, expect, it } from "vitest";
import { share, summarizeScouting } from "./lead-summary";

const roster = [
  { teamKey: "frc118", teamNumber: 118, nickname: "Robonauts" },
  { teamKey: "frc254", teamNumber: 254, nickname: "Cheesy Poofs" },
  { teamKey: "frc1678", teamNumber: 1678, nickname: "Citrus Circuits" },
  { teamKey: "frc6925", teamNumber: 6925, nickname: null },
];
const matches = [
  { matchKey: "e_qm1", teamKeys: ["frc118", "frc254", "frc1678", "frc6925"], played: true },
  { matchKey: "e_qm2", teamKeys: ["frc118", "frc254", "frc1678", "frc6925"], played: false },
];

describe("scouting summary", () => {
  it("counts pits against every other team at the event, never our own", () => {
    const summary = summarizeScouting({
      roster,
      ownTeamNumber: 6925,
      matches: [],
      entries: [{ type: "pit", matchKey: null, teamKey: "frc254", scoutUserId: "a", updatedAt: "2026-10-01T10:00:00Z" }],
      assignments: [],
      members: [],
      userId: "a",
    });
    expect(summary.pit).toEqual({
      total: 3,
      visited: 1,
      notVisited: [roster[0], roster[2]],
      teams: [
        { ...roster[0], visited: false },
        { ...roster[1], visited: true },
        { ...roster[2], visited: false },
      ],
      otherVisited: [],
    });
    expect(summary.me.pitReports).toBe(1);
  });

  it("keeps a pit visit to a team that is not at the event out of the event's pit count", () => {
    const summary = summarizeScouting({
      roster,
      ownTeamNumber: 6925,
      matches: [],
      entries: [
        { type: "pit", matchKey: null, teamKey: "frc254", scoutUserId: "a", updatedAt: "2026-10-01T10:00:00Z" },
        // A typo: 9401 is not at the event. It used to become a 24th roster team, "4/24 visited".
        { type: "pit", matchKey: null, teamKey: "frc9401", scoutUserId: "a", updatedAt: "2026-10-01T10:05:00Z" },
      ],
      assignments: [],
      members: [],
      userId: "a",
    });
    expect(summary.pit.total).toBe(3);
    expect(summary.pit.visited).toBe(1);
    expect(summary.pit.otherVisited).toEqual([{ teamKey: "frc9401", teamNumber: 9401, nickname: null }]);
    // Still the scout's own work.
    expect(summary.me.pitReports).toBe(2);
  });

  it("splits match coverage into lost robots and fixable ones", () => {
    const summary = summarizeScouting({
      roster,
      ownTeamNumber: 6925,
      matches,
      entries: [
        { type: "match", matchKey: "e_qm1", teamKey: "frc118", scoutUserId: "a", updatedAt: "2026-10-01T10:00:00Z" },
        { type: "match", matchKey: "e_qm1", teamKey: "frc118", scoutUserId: "b", updatedAt: "2026-10-01T10:01:00Z" },
        { type: "match", matchKey: "e_qm2", teamKey: "frc254", scoutUserId: "a", updatedAt: "2026-10-01T10:05:00Z" },
      ],
      assignments: [{ matchKey: "e_qm2", teamKey: "frc1678", userId: "b", name: "Bea", role: "primary" }],
      members: [],
      userId: "a",
    });
    expect(summary.match).toEqual({
      playedMatches: 1,
      playedRobots: 4,
      playedScouted: 1,
      playedMissed: 3,
      upcomingRobots: 4,
      upcomingUnassigned: 2,
      reports: 3,
    });
  });

  it("charges missed assignments to the scout and lists scouts by work done", () => {
    const summary = summarizeScouting({
      roster,
      ownTeamNumber: 6925,
      matches,
      entries: [
        { type: "match", matchKey: "e_qm1", teamKey: "frc118", scoutUserId: "a", updatedAt: "2026-10-01T10:00:00Z" },
        { type: "pit", matchKey: null, teamKey: "frc118", scoutUserId: "a", updatedAt: "2026-10-01T09:00:00Z" },
      ],
      assignments: [
        { matchKey: "e_qm1", teamKey: "frc254", userId: "b", name: "Bea", role: "primary" },
        { matchKey: "e_qm2", teamKey: "frc1678", userId: "b", name: "Bea", role: "primary" },
      ],
      members: [
        { userId: "a", name: "Ari", role: "scout" },
        { userId: "b", name: "Bea", role: "scout" },
        { userId: "c", name: "Cam", role: "scout" },
        { userId: "m", name: "Mentor", role: "mentor" },
      ],
      userId: "b",
    });
    expect(summary.scouts.map((row) => [row.name, row.pitReports, row.matchReports, row.missed, row.upcoming])).toEqual([
      ["Ari", 1, 1, 0, 0],
      ["Bea", 0, 0, 1, 1],
      ["Cam", 0, 0, 0, 0],
    ]);
    expect(summary.scouts[0]!.lastActiveAt).toBe("2026-10-01T10:00:00Z");
    expect(summary.me).toEqual({ pitReports: 0, matchReports: 0, missed: 1, upcoming: 1 });
  });

  it("reports a share only when there is something to divide", () => {
    expect(share(1, 3)).toBe(33);
    expect(share(0, 0)).toBeNull();
  });
});
