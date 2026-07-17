import { describe, expect, it } from "vitest";
import { daysUntilDeadline, essayStats, isUrgent, submissionReadiness } from "./submission-progress";

describe("essay stats", () => {
  it("flags essays over their character limit", () => {
    const stats = essayStats({ content: "a".repeat(120), charLimit: 100 });
    expect(stats.overLimit).toBe(true);
    expect(stats.remaining).toBe(-20);
  });

  it("has no limit concept when charLimit is null", () => {
    const stats = essayStats({ content: "short", charLimit: null });
    expect(stats.overLimit).toBe(false);
    expect(stats.remaining).toBeNull();
  });
});

describe("submission readiness", () => {
  it("is not ready when items are incomplete", () => {
    const readiness = submissionReadiness([
      { content: "done", charLimit: null, done: true },
      { content: null, charLimit: null, done: false },
    ]);
    expect(readiness.readyToSubmit).toBe(false);
    expect(readiness.percentComplete).toBe(50);
  });

  it("is ready when every item has content or is marked done", () => {
    expect(submissionReadiness([{ content: "done", charLimit: null, done: true }]).readyToSubmit).toBe(true);
  });

  it("is not ready when there are zero items", () => {
    expect(submissionReadiness([]).readyToSubmit).toBe(false);
  });
});

describe("deadline urgency", () => {
  it("flags deadlines inside the urgency window", () => {
    const now = new Date("2026-07-17T00:00:00Z");
    expect(daysUntilDeadline("2026-07-20T00:00:00Z", now)).toBe(3);
    expect(isUrgent("2026-07-20T00:00:00Z", 14, now)).toBe(true);
    expect(isUrgent("2026-09-20T00:00:00Z", 14, now)).toBe(false);
  });

  it("returns null for a missing deadline", () => {
    expect(daysUntilDeadline(null)).toBeNull();
  });
});
