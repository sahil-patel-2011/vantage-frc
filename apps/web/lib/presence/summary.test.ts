import { describe, expect, it } from "vitest";
import { reconcilePresence } from "./reconcile";
import { formatMinutes, memberGoalBoard, summarizePresence } from "./summary";
import type { PresenceMemberRow } from "./types";

const DATE = "2026-02-10";

function rows(): PresenceMemberRow[] {
  return reconcilePresence({
    rsvps: [
      { userId: "u1", name: "Ada", response: "going" },
      { userId: "u2", name: "Bo", response: "going" },
      { userId: "u3", name: "Cy", response: "no" },
    ],
    rollCall: [
      { userId: "u1", name: "Ada", present: true },
      { userId: "u4", name: "Dee", present: true },
    ],
    hourLogs: [{ userId: "u1", name: "Ada", hourLogId: "h1", minutes: 150 }],
    occurrenceDate: DATE,
    rollCallTaken: true,
  });
}

describe("summarizePresence", () => {
  it("computes turnout only when both sides of the ratio are real", () => {
    const summary = summarizePresence({
      rows: rows(),
      rosterCount: 10,
      rollCallTaken: true,
      rsvpsRecorded: true,
    });
    // 1 of the 2 who said going was on the roll call.
    expect(summary.turnout.value).toBe(50);
    expect(summary.turnout.reason).toBeNull();
  });

  it("returns null turnout with a reason when nobody RSVP'd — never 0%", () => {
    const summary = summarizePresence({
      rows: reconcilePresence({
        rsvps: [],
        rollCall: [{ userId: "u1", name: "Ada", present: true }],
        hourLogs: [],
        occurrenceDate: DATE,
        rollCallTaken: true,
      }),
      rosterCount: 10,
      rollCallTaken: true,
      rsvpsRecorded: false,
    });
    expect(summary.turnout.value).toBeNull();
    expect(summary.turnout.reason).toMatch(/RSVP/);
    expect(summary.turnout.label).toBe("Not available");
  });

  it("returns null turnout with a reason when no roll call was taken", () => {
    const summary = summarizePresence({
      rows: reconcilePresence({
        rsvps: [{ userId: "u1", name: "Ada", response: "going" }],
        rollCall: [],
        hourLogs: [],
        occurrenceDate: DATE,
        rollCallTaken: false,
      }),
      rosterCount: 10,
      rollCallTaken: false,
      rsvpsRecorded: true,
    });
    expect(summary.turnout.value).toBeNull();
    expect(summary.turnout.reason).toMatch(/roll call/);
  });

  it("counts no-record members without calling them absent", () => {
    const summary = summarizePresence({
      rows: rows(),
      rosterCount: 10,
      rollCallTaken: true,
      rsvpsRecorded: true,
    });
    expect(summary.noRecordCount).toBe(6);
    expect(summary.presentCount).toBe(2);
    expect(summary.respondedCount).toBe(3);
    expect(summary.goingCount).toBe(2);
    expect(summary.notComingCount).toBe(1);
    expect(summary.totalMinutes).toBe(150);
    expect(summary.discrepancyCount).toBeGreaterThan(0);
  });

  it("reports null total minutes rather than zero when nothing is clocked", () => {
    const summary = summarizePresence({
      rows: reconcilePresence({
        rsvps: [{ userId: "u1", name: "Ada", response: "going" }],
        rollCall: [],
        hourLogs: [],
        occurrenceDate: DATE,
      }),
      rosterCount: 4,
      rollCallTaken: false,
      rsvpsRecorded: true,
    });
    expect(summary.totalMinutes).toBeNull();
  });

  it("has no response rate without a roster", () => {
    const summary = summarizePresence({
      rows: [],
      rosterCount: 0,
      rollCallTaken: false,
      rsvpsRecorded: false,
    });
    expect(summary.responseRate.value).toBeNull();
    expect(summary.responseRate.reason).toMatch(/roster/i);
  });
});

describe("memberGoalBoard", () => {
  it("sorts by name, never by hours — this is not a leaderboard", () => {
    const board = memberGoalBoard(
      [
        { userId: "u1", name: "Zoe", totalHours: 90 },
        { userId: "u2", name: "Ada", totalHours: 4 },
      ],
      60,
    );
    expect(board.map((row) => row.name)).toEqual(["Ada", "Zoe"]);
    expect(board[1].percent).toBe(100);
    expect(board[0].label).toBe("4 of 60 h");
  });

  it("says the goal is unset instead of inventing one", () => {
    const board = memberGoalBoard([{ userId: "u1", name: "Ada", totalHours: 12.345 }], null);
    expect(board[0].goalHours).toBeNull();
    expect(board[0].percent).toBeNull();
    expect(board[0].label).toMatch(/no season hour goal set/);
    expect(board[0].totalHours).toBe(12.35);
  });

  it("treats a zero or negative goal as unset", () => {
    expect(memberGoalBoard([{ userId: "u1", name: "Ada", totalHours: 3 }], 0)[0].goalHours).toBeNull();
  });
});

describe("formatMinutes", () => {
  it("renders an em dash for nothing real", () => {
    expect(formatMinutes(null)).toBe("—");
    expect(formatMinutes(0)).toBe("—");
  });

  it("renders hours and minutes", () => {
    expect(formatMinutes(45)).toBe("45 m");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(150.4)).toBe("2 h 30 m");
  });
});
