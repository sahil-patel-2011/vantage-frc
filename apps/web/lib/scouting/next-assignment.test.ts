import { describe, expect, it } from "vitest";
import {
  advanceAfterMatchSave,
  formatAssignmentLabel,
  nextUnscoutedAssignment,
  remainingUnscoutedCount,
  scoutedAssignmentKeys,
  scoutTeamLabel,
} from "./next-assignment";

const assignments = [
  { matchKey: "2026casj_qm1", teamKey: "frc254", compLevel: "qm", matchNumber: 1 },
  { matchKey: "2026casj_qm2", teamKey: "frc1678", compLevel: "qm", matchNumber: 2 },
  { matchKey: "2026casj_qm3", teamKey: "frc118", compLevel: "qm", matchNumber: 3 },
];

describe("nextUnscoutedAssignment", () => {
  it("returns the first assigned robot that this scout has not saved", () => {
    const scouted = scoutedAssignmentKeys(
      [
        {
          type: "match",
          matchKey: "2026casj_qm1",
          teamKey: "frc254",
          scoutUserId: "me",
        },
      ],
      "me",
    );
    expect(nextUnscoutedAssignment(assignments, scouted)?.teamKey).toBe("frc1678");
  });

  it("ignores another scout's report on the same robot", () => {
    const scouted = scoutedAssignmentKeys(
      [
        {
          type: "match",
          matchKey: "2026casj_qm1",
          teamKey: "frc254",
          scoutUserId: "other",
        },
      ],
      "me",
    );
    expect(nextUnscoutedAssignment(assignments, scouted)?.teamKey).toBe("frc254");
  });

  it("returns null when every assigned robot is saved — never invents a match", () => {
    const scouted = scoutedAssignmentKeys(
      assignments.map((row) => ({
        type: "match",
        matchKey: row.matchKey,
        teamKey: row.teamKey,
        scoutUserId: "me",
      })),
      "me",
    );
    expect(nextUnscoutedAssignment(assignments, scouted)).toBeNull();
    expect(remainingUnscoutedCount(assignments, assignments[2]!, scouted)).toBe(0);
    expect(remainingUnscoutedCount(assignments, assignments[0]!, new Set())).toBe(2);
  });
});

describe("advanceAfterMatchSave", () => {
  it("moves to the next assigned robot, not the same team in the next qual", () => {
    const saved = { matchKey: "2026casj_qm1", teamKey: "frc254" };
    const scouted = scoutedAssignmentKeys([], "me", [saved]);
    expect(
      advanceAfterMatchSave({
        assignments,
        saved,
        scouted,
        stepMatchKey: () => "2026casj_qm2",
      }),
    ).toEqual({ matchKey: "2026casj_qm2", teamKey: "frc1678" });
  });

  it("steps the match number only when there is no assignment list", () => {
    expect(
      advanceAfterMatchSave({
        assignments: [],
        saved: { matchKey: "qm12", teamKey: "frc254" },
        scouted: new Set(),
        stepMatchKey: (key) => (key === "qm12" ? "qm13" : null),
      }),
    ).toEqual({ matchKey: "qm13", teamKey: "frc254" });
  });
});

describe("formatAssignmentLabel", () => {
  it("shows qual number and team without the frc prefix", () => {
    expect(scoutTeamLabel("frc254")).toBe("254");
    expect(formatAssignmentLabel(assignments[0]!)).toBe("QM 1 · 254");
  });
});
