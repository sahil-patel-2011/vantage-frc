import { describe, expect, it } from "vitest";
import {
  URGENCY_LABELS,
  URGENCY_TONES,
  countdownLabel,
  formatDateRange,
  formatIsoDate,
  ownerLabel,
  summaryLine,
  toneColor,
} from "./roadmap-presentation";
import { ROADMAP_TASKS, type TaskUrgency } from "./season-roadmap";

const ALL_URGENCIES: TaskUrgency[] = [
  "overdue",
  "now",
  "soon",
  "later",
  "undated",
  "done",
  "skipped",
];

describe("urgency vocabulary", () => {
  it("labels every urgency without claiming a FIRST deadline", () => {
    for (const urgency of ALL_URGENCIES) {
      expect(URGENCY_LABELS[urgency]).toBeTruthy();
    }
    // The word "deadline" would imply we know FIRST's dates. We only know the team's.
    for (const label of Object.values(URGENCY_LABELS)) {
      expect(label.toLowerCase()).not.toContain("deadline");
    }
  });

  it("gives every urgency a token-backed tone, never a raw colour", () => {
    for (const urgency of ALL_URGENCIES) {
      const tone = URGENCY_TONES[urgency];
      expect(tone).toBeTruthy();
      expect(toneColor(tone)).toMatch(/^var\(--(?:critical|warning|accent|muted|positive)\)$/);
    }
  });

  it("labels every owner role used by a real task", () => {
    for (const task of ROADMAP_TASKS) {
      expect(ownerLabel(task.ownerRole)).toBeTruthy();
    }
  });
});

describe("countdownLabel", () => {
  it("returns null with no dates — never a guessed countdown", () => {
    expect(countdownLabel(null, "2026-01-10")).toBeNull();
  });

  it("counts down to a future window", () => {
    expect(countdownLabel({ start: "2026-01-22", end: "2026-01-28" }, "2026-01-10")).toBe(
      "Starts in 12 days",
    );
  });

  it("uses the singular for one day", () => {
    expect(countdownLabel({ start: "2026-01-11", end: "2026-01-18" }, "2026-01-10")).toBe(
      "Starts in 1 day",
    );
  });

  it("reports days left inside an open window", () => {
    expect(countdownLabel({ start: "2026-01-05", end: "2026-01-13" }, "2026-01-10")).toBe(
      "3 days left in this window",
    );
  });

  it("calls out the last day", () => {
    expect(countdownLabel({ start: "2026-01-05", end: "2026-01-10" }, "2026-01-10")).toBe(
      "Last day of this window",
    );
  });

  it("says the window closed, not that a deadline was missed", () => {
    const label = countdownLabel({ start: "2025-12-01", end: "2025-12-08" }, "2025-12-12");
    expect(label).toBe("Window closed 4 days ago");
    expect(label?.toLowerCase()).not.toContain("missed");
  });

  it("returns null for a malformed date rather than rendering NaN", () => {
    expect(countdownLabel({ start: "not-a-date", end: "2026-01-10" }, "2026-01-01")).toBeNull();
  });
});

describe("date formatting", () => {
  it("formats an ISO date in UTC, immune to the viewer's timezone", () => {
    expect(formatIsoDate("2026-01-03")).toBe("3 Jan 2026");
    expect(formatIsoDate("2026-12-31")).toBe("31 Dec 2026");
  });

  it("rejects malformed input", () => {
    expect(formatIsoDate("2026-13-01")).toBeNull();
    expect(formatIsoDate("Jan 3")).toBeNull();
  });

  it("collapses a single-day range", () => {
    expect(formatDateRange({ start: "2026-01-03", end: "2026-01-03" })).toBe("3 Jan 2026");
  });

  it("renders a real range", () => {
    expect(formatDateRange({ start: "2026-01-03", end: "2026-01-09" })).toBe(
      "3 Jan 2026 – 9 Jan 2026",
    );
  });

  it("returns null with no dates", () => {
    expect(formatDateRange(null)).toBeNull();
  });
});

describe("summaryLine", () => {
  const base = { total: 40, done: 0, skipped: 0, overdue: 0, dueNow: 0, percentComplete: 0 };

  it("invites a kickoff date instead of showing a fake score", () => {
    expect(summaryLine(base, false)).toContain("Set your kickoff date");
  });

  it("says nothing is ticked yet when a date is set", () => {
    expect(summaryLine(base, true)).toBe("40 tasks on the roadmap. Nothing ticked off yet.");
  });

  it("reports progress with overdue taking precedence over due-now", () => {
    expect(
      summaryLine({ total: 40, done: 12, skipped: 3, overdue: 2, dueNow: 5, percentComplete: 32 }, true),
    ).toBe("12 of 40 done · 3 skipped · 2 past their window.");
  });

  it("falls back to due-now when nothing is overdue", () => {
    expect(
      summaryLine({ total: 40, done: 12, skipped: 0, overdue: 0, dueNow: 5, percentComplete: 30 }, true),
    ).toBe("12 of 40 done · 5 due now.");
  });

  it("handles an empty roadmap without dividing by zero", () => {
    expect(
      summaryLine({ total: 0, done: 0, skipped: 0, overdue: 0, dueNow: 0, percentComplete: 0 }, true),
    ).toBe("No tasks to show.");
  });
});
