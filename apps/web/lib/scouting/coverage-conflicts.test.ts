import { describe, expect, it } from "vitest";
import { planAutoAssignments } from "./coverage";
import { assignmentConflict, type AssignmentConflictContext } from "./assignment-conflicts";

const slot = (matchKey: string, teamKey: string, matchNumber: number) => ({
  matchKey,
  teamKey,
  status: "unscouted" as const,
  assignmentCount: 0,
  matchNumber,
  compLevel: "qm",
});

describe("planAutoAssignments conflict rules", () => {
  it("never puts one member on two robots of the same match", () => {
    const plan = planAutoAssignments({
      slots: [slot("e_qm1", "frc1", 1), slot("e_qm1", "frc2", 1), slot("e_qm1", "frc3", 1)],
      scouts: [
        { userId: "a", assignedCount: 0 },
        { userId: "b", assignedCount: 0 },
      ],
    });
    expect(plan.map((row) => row.userId)).toEqual(["a", "b"]);
  });

  it("skips members blocked by drive team or an existing assignment in that match", () => {
    const ctx: AssignmentConflictContext = {
      ourTeamKey: "frc6925",
      standingDriveTeam: new Set(["driver"]),
      driveDuties: [],
      matches: new Map([["e_qm1", { matchKey: "e_qm1", teamKeys: ["frc6925", "frc1", "frc2"], time: null }]]),
      assignments: [{ userId: "busy", matchKey: "e_qm1", teamKey: "frc2" }],
    };
    const plan = planAutoAssignments({
      slots: [slot("e_qm1", "frc1", 1)],
      scouts: [
        { userId: "driver", assignedCount: 0 },
        { userId: "busy", assignedCount: 0 },
        { userId: "free", assignedCount: 9 },
      ],
      isBlocked: (userId, s) => assignmentConflict(ctx, { userId, ...s }) != null,
    });
    expect(plan).toEqual([{ matchKey: "e_qm1", teamKey: "frc1", userId: "free" }]);
  });

  it("leaves the gap when nobody can take it", () => {
    expect(
      planAutoAssignments({
        slots: [slot("e_qm1", "frc1", 1)],
        scouts: [{ userId: "a", assignedCount: 0 }],
        isBlocked: () => true,
      }),
    ).toEqual([]);
  });
});
