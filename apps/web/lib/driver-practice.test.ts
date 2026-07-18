import { describe, expect, it } from "vitest";
import {
  actionBreakdown,
  parseDriverPracticeAction,
  sessionStats,
  type DriverCycle,
} from "./driver-practice";

const ORG = "11111111-1111-4111-8111-111111111111";
const SID = "22222222-2222-4222-8222-222222222222";

function cycle(overrides: Partial<DriverCycle>): DriverCycle {
  return {
    id: "c",
    sessionId: SID,
    action: "Score high",
    seconds: 5,
    success: true,
    note: "",
    repIndex: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("sessionStats", () => {
  it("handles an empty set", () => {
    expect(sessionStats([])).toEqual({ reps: 0, timed: 0, successes: 0, successRate: null, avgSeconds: null, bestSeconds: null });
  });
  it("computes success rate, average, and best successful time", () => {
    const stats = sessionStats([
      cycle({ seconds: 6, success: true }),
      cycle({ seconds: 4, success: true }),
      cycle({ seconds: 3, success: false }),
      cycle({ seconds: null, success: true }),
    ]);
    expect(stats.reps).toBe(4);
    expect(stats.timed).toBe(3);
    expect(stats.successes).toBe(3);
    expect(stats.successRate).toBe(75);
    expect(stats.avgSeconds).toBe(4.33);
    expect(stats.bestSeconds).toBe(4);
  });
});

describe("actionBreakdown", () => {
  it("groups by action and orders by reps", () => {
    const rows = actionBreakdown([
      cycle({ action: "Intake", seconds: 2, success: true }),
      cycle({ action: "Score high", seconds: 5, success: true }),
      cycle({ action: "Score high", seconds: 7, success: false }),
      cycle({ action: "Score high", seconds: 6, success: true }),
    ]);
    expect(rows[0]!.action).toBe("Score high");
    expect(rows[0]!.reps).toBe(3);
    expect(rows[0]!.successRate).toBe(67);
    expect(rows[0]!.avgSeconds).toBe(6);
    expect(rows[1]!.action).toBe("Intake");
  });
});

describe("parseDriverPracticeAction", () => {
  it("creates a session with normalized date and optional fields defaulted", () => {
    const action = parseDriverPracticeAction({ action: "create_session", orgId: ORG, title: "Sat scrimmage", sessionDate: "2026-02-14" });
    expect(action).toMatchObject({
      action: "create_session",
      title: "Sat scrimmage",
      sessionDate: "2026-02-14",
      location: "",
      goal: "",
      attendanceEventId: null,
      buildTaskId: null,
    });
  });
  it("accepts optional attendance and build-task links on create and update", () => {
    const attendanceId = "33333333-3333-4333-8333-333333333333";
    const taskId = "44444444-4444-4444-8444-444444444444";
    const created = parseDriverPracticeAction({
      action: "create_session",
      orgId: ORG,
      title: "Linked practice",
      attendanceEventId: attendanceId,
      buildTaskId: taskId,
    });
    expect(created).toMatchObject({ attendanceEventId: attendanceId, buildTaskId: taskId });
    const updated = parseDriverPracticeAction({
      action: "update_session",
      orgId: ORG,
      id: SID,
      attendanceEventId: null,
      buildTaskId: taskId,
    });
    expect(updated).toMatchObject({
      action: "update_session",
      patch: { attendanceEventId: null, buildTaskId: taskId },
    });
  });
  it("rejects a blank title and an invalid date", () => {
    expect(() => parseDriverPracticeAction({ action: "create_session", orgId: ORG, title: "  " })).toThrow(/required/);
    expect(() => parseDriverPracticeAction({ action: "create_session", orgId: ORG, title: "x", sessionDate: "not-a-date" })).toThrow(/date is invalid/i);
  });
  it("adds a cycle, defaulting success true and allowing untimed reps", () => {
    const action = parseDriverPracticeAction({ action: "add_cycle", orgId: ORG, sessionId: SID, cycleAction: "Climb" });
    expect(action).toMatchObject({ action: "add_cycle", cycleAction: "Climb", success: true, seconds: null });
  });
  it("validates the seconds range", () => {
    expect(() => parseDriverPracticeAction({ action: "add_cycle", orgId: ORG, sessionId: SID, cycleAction: "x", seconds: 5000 })).toThrow(/between 0 and 3600/);
  });
  it("builds a sparse cycle patch and rejects empty updates", () => {
    expect(parseDriverPracticeAction({ action: "update_cycle", orgId: ORG, id: SID, success: false })).toMatchObject({
      patch: { success: false },
    });
    expect(() => parseDriverPracticeAction({ action: "update_cycle", orgId: ORG, id: SID })).toThrow(/No changes/);
  });
});
