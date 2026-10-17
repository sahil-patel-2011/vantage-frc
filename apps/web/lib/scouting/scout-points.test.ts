import { describe, expect, it } from "vitest";
import { POINTS, scoutPoints } from "./scout-points";

describe("scoutPoints", () => {
  it("scores filed work only, with a bonus for covering your own assignment", () => {
    const points = scoutPoints({
      entries: [
        { type: "match", matchKey: "2026casj_qm1", teamKey: "frc254", scoutUserId: "a" },
        { type: "match", matchKey: "2026casj_qm2", teamKey: "frc1678", scoutUserId: "a" },
        { type: "pit", matchKey: null, teamKey: "frc604", scoutUserId: "a" },
        { type: "match", matchKey: "2026casj_qm2", teamKey: "frc8", scoutUserId: "b" },
      ],
      assignments: [
        { userId: "a", matchKey: "2026casj_qm1", teamKey: "frc254" },
        { userId: "b", matchKey: "2026casj_qm3", teamKey: "frc8" },
      ],
    });
    expect(points.get("a")).toEqual({ points: 2 * POINTS.match + POINTS.pit + POINTS.assignedCovered, bestStreak: 2, assignedCovered: 1 });
    expect(points.get("b")).toEqual({ points: POINTS.match, bestStreak: 1, assignedCovered: 0 });
  });

  it("counts the longest run of consecutive qualification matches", () => {
    const entries = [1, 2, 3, 5, 6, 7, 8].map((n) => ({ type: "match" as const, matchKey: `2026casj_qm${n}`, teamKey: "frc1", scoutUserId: "a" }));
    expect(scoutPoints({ entries, assignments: [] }).get("a")?.bestStreak).toBe(4);
  });

  it("doesn't reward backup assignments", () => {
    const points = scoutPoints({
      entries: [{ type: "match", matchKey: "2026casj_qm1", teamKey: "frc1", scoutUserId: "a" }],
      assignments: [{ userId: "a", matchKey: "2026casj_qm1", teamKey: "frc1", role: "backup" }],
      isBackupRole: (role) => role === "backup",
    });
    expect(points.get("a")?.assignedCovered).toBe(0);
  });
});
