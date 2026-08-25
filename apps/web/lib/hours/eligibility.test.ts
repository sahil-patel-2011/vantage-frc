import { describe, expect, it } from "vitest";
import {
  NO_THRESHOLD_LABEL,
  eligibilityBoard,
  formatHoursAgainstThreshold,
  memberEligibility,
  normalizeThreshold,
  summarizeEligibility,
  type MemberHoursTotal,
} from "./eligibility";

function member(overrides: Partial<MemberHoursTotal> & { userId: string }): MemberHoursTotal {
  return {
    name: `Member ${overrides.userId}`,
    role: "member",
    totalHours: 0,
    sessions: 0,
    autoClosedCount: 0,
    openSince: null,
    ...overrides,
  };
}

describe("normalizeThreshold", () => {
  it("treats blank, null, and zero as 'no threshold configured'", () => {
    expect(normalizeThreshold("")).toBeNull();
    expect(normalizeThreshold(null)).toBeNull();
    expect(normalizeThreshold(undefined)).toBeNull();
    expect(normalizeThreshold(0)).toBeNull();
    expect(normalizeThreshold(-5)).toBeNull();
  });

  it("does not invent a number from garbage input", () => {
    expect(normalizeThreshold("sixty")).toBeNull();
    expect(normalizeThreshold(Number.NaN)).toBeNull();
  });

  it("accepts a real threshold and caps an absurd one", () => {
    expect(normalizeThreshold("60")).toBe(60);
    expect(normalizeThreshold(42.567)).toBe(42.57);
    expect(normalizeThreshold(999_999)).toBe(10_000);
  });
});

describe("formatHoursAgainstThreshold", () => {
  it("renders the demanded '42 of 60 hours' shape", () => {
    expect(formatHoursAgainstThreshold(42, 60)).toBe("42 of 60 hours");
  });

  it("says no threshold is set instead of inventing one", () => {
    const text = formatHoursAgainstThreshold(42, null);
    expect(text).toContain("42 hours logged");
    expect(text).toContain(NO_THRESHOLD_LABEL.toLowerCase());
    expect(text).not.toMatch(/\bof \d/);
  });
});

describe("memberEligibility", () => {
  it("marks a member short and reports the remaining hours", () => {
    const row = memberEligibility(member({ userId: "a", totalHours: 42 }), 60);
    expect(row.status).toBe("short");
    expect(row.remainingHours).toBe(18);
    expect(row.percent).toBe(70);
    expect(row.label).toBe("42 of 60 hours");
  });

  it("marks a member met with zero remaining, never negative", () => {
    const row = memberEligibility(member({ userId: "a", totalHours: 75 }), 60);
    expect(row.status).toBe("met");
    expect(row.remainingHours).toBe(0);
    expect(row.percent).toBe(100);
  });

  it("reports not_configured with null progress when no threshold is set", () => {
    const row = memberEligibility(member({ userId: "a", totalHours: 42 }), null);
    expect(row.status).toBe("not_configured");
    expect(row.remainingHours).toBeNull();
    expect(row.percent).toBeNull();
  });

  it("flags auto-closed sessions as capped pending review", () => {
    const row = memberEligibility(member({ userId: "a", totalHours: 42, autoClosedCount: 2 }), 60);
    expect(row.reviewNote).toContain("2 auto-closed sessions");
    expect(row.reviewNote).toContain("mentor review");
  });

  it("has no review note when nothing was auto-closed", () => {
    expect(memberEligibility(member({ userId: "a" }), 60).reviewNote).toBeNull();
  });

  it("never reports negative hours", () => {
    expect(memberEligibility(member({ userId: "a", totalHours: -3 }), 60).totalHours).toBe(0);
  });
});

describe("eligibilityBoard", () => {
  it("puts members closest to eligible first so mentors see who is nearly there", () => {
    const rows = eligibilityBoard(
      [
        member({ userId: "far", totalHours: 10 }),
        member({ userId: "close", totalHours: 55 }),
        member({ userId: "done", totalHours: 80 }),
      ],
      60,
    );
    expect(rows.map((row) => row.userId)).toEqual(["close", "far", "done"]);
  });

  it("falls back to most-hours-first when no threshold is configured", () => {
    const rows = eligibilityBoard(
      [member({ userId: "low", totalHours: 5 }), member({ userId: "high", totalHours: 50 })],
      null,
    );
    expect(rows.map((row) => row.userId)).toEqual(["high", "low"]);
  });

  it("is stable and does not mutate its input", () => {
    const totals = [member({ userId: "b", totalHours: 20 }), member({ userId: "a", totalHours: 20 })];
    const snapshot = JSON.parse(JSON.stringify(totals));
    const first = eligibilityBoard(totals, 60);
    const second = eligibilityBoard(totals, 60);
    expect(first).toEqual(second);
    expect(totals).toEqual(snapshot);
  });

  it("returns an empty board for an empty roster", () => {
    expect(eligibilityBoard([], 60)).toEqual([]);
  });
});

describe("summarizeEligibility", () => {
  it("counts who is eligible against a configured threshold", () => {
    const board = eligibilityBoard(
      [
        member({ userId: "a", totalHours: 80 }),
        member({ userId: "b", totalHours: 61 }),
        member({ userId: "c", totalHours: 10 }),
      ],
      60,
    );
    const summary = summarizeEligibility(board, 60);
    expect(summary.eligible).toBe(2);
    expect(summary.short).toBe(1);
    expect(summary.headline).toContain("2 of 3 members");
  });

  it("states plainly that no threshold is set", () => {
    const board = eligibilityBoard([member({ userId: "a", totalHours: 42 })], null);
    const summary = summarizeEligibility(board, null);
    expect(summary.thresholdHours).toBeNull();
    expect(summary.eligible).toBeNull();
    expect(summary.headline).toContain(NO_THRESHOLD_LABEL);
  });

  it("does not claim 'no threshold set' for a configured org with an empty roster", () => {
    const summary = summarizeEligibility([], 60);
    expect(summary.thresholdHours).toBe(60);
    expect(summary.headline).not.toContain(NO_THRESHOLD_LABEL);
    expect(summary.headline).toContain("60 hours");
  });

  it("totals the flagged auto-closed sessions across the roster", () => {
    const board = eligibilityBoard(
      [
        member({ userId: "a", totalHours: 40, autoClosedCount: 2 }),
        member({ userId: "b", totalHours: 20, autoClosedCount: 1 }),
      ],
      60,
    );
    expect(summarizeEligibility(board, 60).flaggedSessions).toBe(3);
  });
});
