import { describe, expect, it } from "vitest";
import { computeBuildCompletionPct, computeSeasonPlanProgress, currentSeasonYear } from ".";

describe("season-planning-workspace helpers", () => {
  it("returns null completion when there is no data — never DEMO %", () => {
    expect(computeBuildCompletionPct(0, 0)).toBeNull();
    expect(computeBuildCompletionPct(3, 10)).toBe(30);
    const progress = computeSeasonPlanProgress({
      goalsDone: 0,
      goalsTotal: 0,
      milestonesDone: 0,
      milestonesTotal: 0,
      signals: {
        attendanceEventCount: 0,
        attendanceEntryCount: 0,
        buildTaskTotal: 0,
        buildTaskDone: 0,
        buildCompletionPct: null,
      },
    });
    expect(progress.milestoneCompletionPct).toBeNull();
    expect(progress.signals.buildCompletionPct).toBeNull();
  });

  it("computes milestone % from real denominators only", () => {
    const progress = computeSeasonPlanProgress({
      goalsDone: 1,
      goalsTotal: 4,
      milestonesDone: 2,
      milestonesTotal: 8,
      signals: {
        attendanceEventCount: 5,
        attendanceEntryCount: 40,
        buildTaskTotal: 10,
        buildTaskDone: 4,
        buildCompletionPct: 40,
      },
    });
    expect(progress.milestoneCompletionPct).toBe(25);
    expect(currentSeasonYear(new Date("2026-07-20T12:00:00Z"))).toBe(2026);
  });
});
