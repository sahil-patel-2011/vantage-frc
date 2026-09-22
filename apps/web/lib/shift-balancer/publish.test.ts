import { describe, expect, it } from "vitest";
import { describePublish, publishableAssignments } from ".";
import type { ShiftBalancerAssignment } from "./types";

function shift(partial: Partial<ShiftBalancerAssignment>): ShiftBalancerAssignment {
  return {
    match: 1,
    station: "Red 1",
    scoutId: "s1",
    scoutName: "Ada",
    matchKey: "2026miket_qm1",
    teamKey: "frc6925",
    scheduledAt: "2026-03-07T14:00:00Z",
    ...partial,
  };
}

const scouts = [
  { id: "s1", userId: "u1" },
  { id: "s2", userId: null },
  { id: "s3", userId: "u3" },
];

describe("publishableAssignments", () => {
  it("turns a planned shift into an assignment for the member behind it", () => {
    const preview = publishableAssignments([shift({})], scouts);
    expect(preview.rows).toEqual([
      {
        userId: "u1",
        matchKey: "2026miket_qm1",
        teamKey: "frc6925",
        station: "Red 1",
        startsAt: "2026-03-07T14:00:00Z",
      },
    ]);
  });

  it("skips scouts with no account instead of dropping them from the plan", () => {
    // A parent volunteer still rotates and still gets a tablet sheet; they just
    // have nobody to assign to.
    const preview = publishableAssignments([shift({ scoutId: "s2", scoutName: "Volunteer" })], scouts);
    expect(preview.rows).toEqual([]);
    expect(preview.skippedNoMember).toBe(1);
  });

  it("refuses to publish a shift that was never put on a real match", () => {
    // Inventing a match would stand a student in front of a robot that is not
    // playing.
    const preview = publishableAssignments(
      [shift({ matchKey: undefined }), shift({ teamKey: undefined })],
      scouts,
    );
    expect(preview.rows).toEqual([]);
    expect(preview.skippedNoMatch).toBe(2);
  });

  it("collapses a repeat so the publish cannot fight its own unique constraint", () => {
    // scout_assignments is unique on (org, user, match, team).
    const preview = publishableAssignments([shift({}), shift({ station: "Blue 2" })], scouts);
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]?.station).toBe("Red 1");
  });

  it("keeps two members on the same match apart", () => {
    const preview = publishableAssignments(
      [shift({}), shift({ scoutId: "s3", scoutName: "Grace", teamKey: "frc254" })],
      scouts,
    );
    expect(preview.rows.map((row) => row.userId)).toEqual(["u1", "u3"]);
  });

  it("carries a missing start time through as null rather than inventing one", () => {
    const preview = publishableAssignments([shift({ scheduledAt: undefined })], scouts);
    expect(preview.rows[0]?.startsAt).toBeNull();
  });
});

describe("describePublish", () => {
  it("counts what landed and names what did not", () => {
    expect(
      describePublish({ rows: [{} as never, {} as never], skippedNoMember: 3, skippedNoMatch: 0 }),
    ).toBe("2 shifts published; skipped 3 for scouts without an account.");
    expect(describePublish({ rows: [{} as never], skippedNoMember: 0, skippedNoMatch: 0 })).toBe(
      "1 shift published.",
    );
  });

  it("says which thing to fix when nothing can publish", () => {
    expect(describePublish({ rows: [], skippedNoMember: 4, skippedNoMatch: 0 })).toBe(
      "Nothing to publish — link scouts to team members first.",
    );
    expect(describePublish({ rows: [], skippedNoMember: 0, skippedNoMatch: 4 })).toBe(
      "Nothing to publish — build the plan from the event schedule first.",
    );
    expect(describePublish({ rows: [], skippedNoMember: 0, skippedNoMatch: 0 })).toBe(
      "Nothing to publish yet.",
    );
  });
});
