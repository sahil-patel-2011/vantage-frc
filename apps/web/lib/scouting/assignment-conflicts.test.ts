import { describe, expect, it } from "vitest";
import {
  assignmentConflict,
  describeAssignmentConflict,
  isOnDriveTeamForMatch,
  labelFromMatchKey,
  withAssignment,
  type AssignmentConflictContext,
} from "./assignment-conflicts";

const Q = (n: number) => `2026casj_qm${n}`;

function context(partial: Partial<AssignmentConflictContext> = {}): AssignmentConflictContext {
  return {
    ourTeamKey: "frc6925",
    standingDriveTeam: new Set(["driver"]),
    driveDuties: [
      { userId: "hp", startsAt: "2026-03-14T16:00:00Z", endsAt: "2026-03-14T18:00:00Z" },
      { userId: "open", startsAt: "2026-03-14T08:00:00Z", endsAt: null },
    ],
    matches: new Map([
      [Q(1), { matchKey: Q(1), teamKeys: ["frc6925", "frc1", "frc2", "frc3", "frc4", "frc5"], time: "2026-03-14T17:00:00Z" }],
      [Q(2), { matchKey: Q(2), teamKeys: ["frc254", "frc1", "frc2", "frc3", "frc4", "frc5"], time: "2026-03-14T17:10:00Z" }],
      [Q(3), { matchKey: Q(3), teamKeys: ["frc6925", "frc7", "frc8"], time: "2026-03-15T09:00:00Z" }],
      [Q(4), { matchKey: Q(4), teamKeys: ["frc6925", "frc9"], time: null }],
    ]),
    assignments: [{ userId: "ada", matchKey: Q(2), teamKey: "frc254", role: "primary" }],
    ...partial,
  };
}

describe("drive team", () => {
  it("blocks the standing drive team only in matches our robot plays", () => {
    const ctx = context();
    expect(isOnDriveTeamForMatch(ctx, "driver", Q(1))).toBe(true);
    expect(isOnDriveTeamForMatch(ctx, "driver", Q(2))).toBe(false);
    expect(assignmentConflict(ctx, { userId: "driver", matchKey: Q(1), teamKey: "frc1" })).toEqual({
      kind: "drive_team",
      userId: "driver",
      matchKey: Q(1),
    });
  });

  it("blocks a drive-team duty only while its window covers our match", () => {
    const ctx = context();
    expect(isOnDriveTeamForMatch(ctx, "hp", Q(1))).toBe(true);
    expect(isOnDriveTeamForMatch(ctx, "hp", Q(3))).toBe(false);
  });

  it("reads a duty with no end as twelve hours, not the whole event", () => {
    const ctx = context();
    expect(isOnDriveTeamForMatch(ctx, "open", Q(1))).toBe(true);
    expect(isOnDriveTeamForMatch(ctx, "open", Q(3))).toBe(false);
  });

  it("cannot place a duty on a match with no time, and has no rule without a team number", () => {
    expect(isOnDriveTeamForMatch(context(), "hp", Q(4))).toBe(false);
    expect(isOnDriveTeamForMatch(context(), "driver", Q(4))).toBe(true);
    expect(isOnDriveTeamForMatch(context({ ourTeamKey: null }), "driver", Q(1))).toBe(false);
  });
});

describe("one scout, one robot", () => {
  it("refuses a second robot in the same match and allows the same robot again", () => {
    const ctx = context();
    expect(assignmentConflict(ctx, { userId: "ada", matchKey: Q(2), teamKey: "frc1" })).toEqual({
      kind: "same_match",
      userId: "ada",
      matchKey: Q(2),
      otherTeamKey: "frc254",
    });
    expect(assignmentConflict(ctx, { userId: "ada", matchKey: Q(2), teamKey: "frc254" })).toBeNull();
    expect(assignmentConflict(ctx, { userId: "ada", matchKey: Q(1), teamKey: "frc1" })).toBeNull();
  });

  it("sees assignments made earlier in the same request", () => {
    const ctx = withAssignment(context(), { userId: "bo", matchKey: Q(1), teamKey: "frc2" });
    expect(assignmentConflict(ctx, { userId: "bo", matchKey: Q(1), teamKey: "frc3" })?.kind).toBe("same_match");
  });
});

describe("conflict copy", () => {
  it("labels match keys the way the field does", () => {
    expect(labelFromMatchKey(Q(12))).toBe("Q12");
    expect(labelFromMatchKey("2026casj_sf2m1")).toBe("SF2-1");
    expect(labelFromMatchKey("2026casj_f1m2")).toBe("F2");
    expect(labelFromMatchKey("custom")).toBe("custom");
  });

  it("says who, which match and why", () => {
    expect(describeAssignmentConflict({ kind: "drive_team", userId: "d", matchKey: Q(3) }, "Dee")).toBe(
      "Dee is on drive team for Q3 — our robot is on the field, so they cannot scout it.",
    );
    expect(
      describeAssignmentConflict({ kind: "same_match", userId: "a", matchKey: Q(2), otherTeamKey: "frc254" }, null),
    ).toBe("That scout is already scouting 254 in Q2 — one scout, one robot.");
  });
});
