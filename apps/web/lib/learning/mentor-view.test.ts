import { describe, expect, it } from "vitest";
import {
  buildMentorRollup,
  summarizeLearningModeOff,
  NEEDS_MENTOR_MIN_SCORED,
  type MentorViewCallRow,
} from "./mentor-view";

const call = (over: Partial<MentorViewCallRow>): MentorViewCallRow => ({
  userId: "u1",
  userName: "Nova",
  surface: "gearbox",
  closeness: "off",
  skipped: false,
  createdAt: "2026-03-01T00:00:00.000Z",
  ...over,
});

describe("buildMentorRollup — the needs-a-mentor rule", () => {
  it("never flags below the stated minimum sample", () => {
    const rows = Array.from({ length: NEEDS_MENTOR_MIN_SCORED - 1 }, (_, i) =>
      call({ createdAt: `2026-03-0${i + 1}T00:00:00.000Z` }),
    );
    const [member] = buildMentorRollup(rows);
    expect(member!.needsMentor).toBe(false);
    expect(member!.surfaces[0]!.status).toBe("not_enough_calls");
    expect(member!.surfaces[0]!.note).toContain("Not enough calls yet");
  });

  it("flags exactly at >= 4 graded calls with zero spot-on", () => {
    const rows = Array.from({ length: NEEDS_MENTOR_MIN_SCORED }, (_, i) =>
      call({ closeness: i % 2 ? "off" : "close", createdAt: `2026-03-0${i + 1}T00:00:00.000Z` }),
    );
    const [member] = buildMentorRollup(rows);
    expect(member!.needsMentor).toBe(true);
    expect(member!.surfaces[0]!.status).toBe("needs_mentor");
  });

  it("a single spot-on clears the flag", () => {
    const rows = [
      call({ closeness: "spot-on", createdAt: "2026-03-01T00:00:00.000Z" }),
      call({ closeness: "off", createdAt: "2026-03-02T00:00:00.000Z" }),
      call({ closeness: "off", createdAt: "2026-03-03T00:00:00.000Z" }),
      call({ closeness: "off", createdAt: "2026-03-04T00:00:00.000Z" }),
    ];
    const [member] = buildMentorRollup(rows);
    expect(member!.needsMentor).toBe(false);
    expect(member!.surfaces[0]!.status).toBe("calibrating");
  });

  it("skips count toward skip rate and debt but never toward the flag", () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) =>
        call({ closeness: null, skipped: true, createdAt: `2026-03-0${i + 1}T00:00:00.000Z` }),
      ),
      call({ closeness: "off", createdAt: "2026-03-07T00:00:00.000Z" }),
      call({ closeness: "off", createdAt: "2026-03-08T00:00:00.000Z" }),
    ];
    const [member] = buildMentorRollup(rows);
    const surface = member!.surfaces[0]!;
    expect(surface.scored).toBe(2);
    expect(surface.skipped).toBe(6);
    expect(surface.skipRate).toBe(0.75);
    // 2 graded calls, both off, 6 skips — still below the 4-graded minimum.
    expect(surface.status).toBe("not_enough_calls");
    expect(member!.totalSkipped).toBe(6);
  });

  it("groups per member per surface, orders flagged members first, and tracks last-called-at", () => {
    const rows = [
      // Struggling on gearbox, but older activity.
      ...Array.from({ length: 4 }, (_, i) =>
        call({ userId: "s1", userName: "Sam", closeness: "off", createdAt: `2026-02-0${i + 1}T00:00:00.000Z` }),
      ),
      // Fine, recent, on a different surface.
      call({ userId: "s2", userName: "Ana", surface: "shooter_table", closeness: "spot-on", createdAt: "2026-03-09T00:00:00.000Z" }),
    ];
    const rollup = buildMentorRollup(rows);
    expect(rollup.map((m) => m.userId)).toEqual(["s1", "s2"]);
    expect(rollup[0]!.lastCalledAt).toBe("2026-02-04T00:00:00.000Z");
    expect(rollup[1]!.surfaces).toHaveLength(1);
    expect(rollup[1]!.surfaces[0]!.surface).toBe("shooter_table");
  });

  it("returns an empty rollup for no rows — never a zeroed table", () => {
    expect(buildMentorRollup([])).toEqual([]);
  });
});

describe("summarizeLearningModeOff", () => {
  it("counts only student-tier members with the mode off", () => {
    const note = summarizeLearningModeOff([
      { userId: "m1", userName: "Mentor", role: "owner", enabled: false },
      { userId: "s1", userName: "Sam", role: "scout", enabled: false },
      { userId: "s2", userName: "Ana", role: "viewer", enabled: true },
      { userId: "s3", userName: null, role: "scout", enabled: false },
    ]);
    expect(note.studentsOff).toBe(2);
    expect(note.students).toBe(3);
    expect(note.offNames).toEqual(["Sam", "Unnamed member"]);
    expect(note.sentence).toContain("off for 2 of 3 students");
  });

  it("says nothing when nobody has it off", () => {
    const note = summarizeLearningModeOff([
      { userId: "s1", userName: "Sam", role: "scout", enabled: true },
    ]);
    expect(note.sentence).toBeNull();
    expect(note.studentsOff).toBe(0);
  });
});
