import { describe, expect, it } from "vitest";
import {
  assignShifts,
  expandShift,
  shiftLabel,
  shiftsFromAssignments,
  shiftsStartingWithin,
  unscoutedMatches,
  type ShiftMatch,
} from "./shifts";

function schedule(count: number, startAt?: Date): ShiftMatch[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return {
      matchKey: `2026test_qm${n}`,
      matchNumber: n,
      red: [`frc${100 + n}`, `frc${200 + n}`, `frc${300 + n}`],
      blue: [`frc${400 + n}`, `frc${500 + n}`, `frc${600 + n}`],
      scheduledTime: startAt ? new Date(startAt.getTime() + index * 8 * 60_000).toISOString() : null,
    };
  });
}

describe("assignShifts", () => {
  it("never double-assigns a robot slot or a scout within one match", () => {
    const result = assignShifts(schedule(12), ["a", "b", "c", "d", "e", "f", "g", "h"]);
    const seenSlot = new Set<string>();
    const seenScout = new Set<string>();
    for (const row of result.assignments) {
      const slot = `${row.matchKey}|${row.alliance}${row.station}`;
      const scout = `${row.matchKey}|${row.userId}`;
      expect(seenSlot.has(slot)).toBe(false);
      expect(seenScout.has(scout)).toBe(false);
      seenSlot.add(slot);
      seenScout.add(scout);
    }
    expect(result.unscouted).toEqual([]);
    expect(result.assignments).toHaveLength(12 * 6);
  });

  function longestRun(matchNumbers: number[]): number {
    let longest = 0;
    let run = 0;
    let prev = 0;
    for (const n of matchNumbers) {
      run = n === prev + 1 ? run + 1 : 1;
      prev = n;
      longest = Math.max(longest, run);
    }
    return longest;
  }

  it("rotates a full spare crew in so nobody exceeds the soft break threshold", () => {
    const scouts = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
    const result = assignShifts(schedule(12), scouts, { breakEvery: 3, maxConsecutive: 10 });
    for (const scout of scouts) {
      const worked = result.assignments.filter((row) => row.userId === scout).map((row) => row.matchNumber);
      expect(longestRun(worked)).toBeLessThanOrEqual(3);
      expect(worked.length).toBeLessThan(12);
    }
    expect(result.idleScouts).toEqual([]);
    expect(result.unscouted).toEqual([]);
  });

  it("with only two spares, every scout still gets a break and runs stay near the threshold", () => {
    const scouts = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const result = assignShifts(schedule(12), scouts, { breakEvery: 3, maxConsecutive: 10 });
    for (const scout of scouts) {
      const worked = result.assignments.filter((row) => row.userId === scout).map((row) => row.matchNumber);
      // Six seats cycle out two at a time, so a run can overshoot the soft threshold by at most two.
      expect(longestRun(worked)).toBeLessThanOrEqual(5);
      expect(worked.length).toBeLessThan(12);
    }
    expect(result.idleScouts).toEqual([]);
    expect(result.unscouted).toEqual([]);
  });

  it("keeps a scout on the same robot slot across a shift (continuity)", () => {
    const result = assignShifts(schedule(6), ["a", "b", "c", "d", "e", "f"], { breakEvery: 6 });
    expect(result.shifts).toHaveLength(6);
    for (const shift of result.shifts) {
      expect(shift.matchStart).toBe(1);
      expect(shift.matchEnd).toBe(6);
      expect(shift.matchKeys).toHaveLength(6);
    }
  });

  it("rests scouts at the hard cap and reports the gap instead of hiding it", () => {
    const result = assignShifts(schedule(4), ["a", "b", "c", "d", "e", "f"], { maxConsecutive: 2, breakEvery: 2 });
    // Six scouts, six slots: after two matches everyone must rest one match.
    const third = result.unscouted.filter((gap) => gap.matchNumber === 3);
    expect(third).toHaveLength(6);
    expect(result.assignments.filter((row) => row.matchNumber === 4)).toHaveLength(6);
  });

  it("handles an empty roster honestly", () => {
    const result = assignShifts(schedule(2), []);
    expect(result.assignments).toEqual([]);
    expect(result.shifts).toEqual([]);
    expect(result.unscouted).toHaveLength(12);
  });

  it("flags matches past the soft threshold when no spare exists", () => {
    const result = assignShifts(schedule(5), ["a", "b", "c", "d", "e", "f"], { breakEvery: 3, maxConsecutive: 10 });
    expect(result.unscouted).toEqual([]);
    expect(result.assignments.some((row) => row.fatigueWarning)).toBe(true);
    expect(result.shifts.every((shift) => shift.fatigueWarning)).toBe(true);
  });
});

describe("shiftsFromAssignments", () => {
  it("splits on schedule gaps, not on match-number gaps", () => {
    const matches = schedule(4);
    // The TBA schedule skips qm3 entirely.
    const withGap = matches.filter((match) => match.matchNumber !== 3);
    const rows = expandShift({ userId: "a", matchStart: 1, matchEnd: 4, alliance: "red", station: 1 }, withGap);
    expect(rows.map((row) => row.matchNumber)).toEqual([1, 2, 4]);
    const shifts = shiftsFromAssignments(rows, withGap);
    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toMatchObject({ matchStart: 1, matchEnd: 4, alliance: "red", station: 1 });
  });
});

describe("unscoutedMatches", () => {
  it("lists only the slots no shift covers", () => {
    const matches = schedule(3);
    const gaps = unscoutedMatches(matches, [
      { userId: "a", matchStart: 1, matchEnd: 3, alliance: "red", station: 1 },
      { userId: "b", matchStart: 1, matchEnd: 2, alliance: "red", station: 2 },
    ]);
    expect(gaps).toHaveLength(3);
    expect(gaps[0]!.gaps).toHaveLength(4);
    expect(gaps[2]!.gaps).toHaveLength(5);
    expect(gaps[2]!.gaps.some((gap) => gap.alliance === "red" && gap.station === 2)).toBe(true);
  });

  it("returns nothing when every slot is covered", () => {
    const result = assignShifts(schedule(4), ["a", "b", "c", "d", "e", "f"], { breakEvery: 4 });
    expect(unscoutedMatches(schedule(4), result.shifts)).toEqual([]);
  });
});

describe("shiftsStartingWithin", () => {
  it("returns shifts whose first match is inside the notify window", () => {
    const start = new Date("2026-03-07T15:00:00Z");
    const matches = schedule(6, start);
    const shifts = [
      { id: "s1", userId: "a", matchStart: 1, matchEnd: 3, alliance: "red" as const, station: 1 as const, notifyMinutesBefore: 10 },
      { id: "s2", userId: "b", matchStart: 4, matchEnd: 6, alliance: "red" as const, station: 1 as const, notifyMinutesBefore: 10 },
      { id: "s3", userId: "c", matchStart: 4, matchEnd: 6, alliance: "red" as const, station: 2 as const, notifyMinutesBefore: 30 },
    ];
    // qm4 starts at 15:24. At 15:16 it is 8 minutes out.
    const due = shiftsStartingWithin(shifts, matches, new Date("2026-03-07T15:16:00Z"));
    expect(due.map((row) => row.shift.id)).toEqual(["s2", "s3"]);
    expect(due[0]!.minutesUntil).toBe(8);
    // s1 started 16 minutes ago — outside the grace window.
    expect(due.some((row) => row.shift.id === "s1")).toBe(false);
  });

  it("skips shifts whose match has no time rather than guessing", () => {
    const shifts = [
      { id: "s1", userId: "a", matchStart: 1, matchEnd: 3, alliance: "red" as const, station: 1 as const, notifyMinutesBefore: 10 },
    ];
    expect(shiftsStartingWithin(shifts, schedule(3), Date.now())).toEqual([]);
  });
});

describe("shiftLabel", () => {
  it("formats ranges and slots", () => {
    expect(shiftLabel({ userId: "a", matchStart: 4, matchEnd: 9, alliance: "red", station: 2 })).toBe("QM 4–9 · R2");
    expect(shiftLabel({ userId: "a", matchStart: 4, matchEnd: 4, alliance: null, station: null })).toBe("QM 4");
  });
});
